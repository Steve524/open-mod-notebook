"""Source-agnostic vault appliers — one set of ops, two drivers.

These functions apply a single per-file change to a `VaultConnection`'s
`vault_file_state` rows and the Source pipeline, without caring whether the
bytes came from a disk walk (`commands/vault_commands.py`, the shelved local
model) or a client push (`api/routers/obsidian.py`, the Obsidian plugin).

The caller supplies a ready ``content_state`` for `process_source`:
``{"file_path": ...}`` for disk (content-core extracts, binary-aware) or
``{"content": ...}`` for push (raw text — verified: content-core returns it
verbatim). The caller also supplies the content hash, mtime, and size; the
applier owns ADD / UPDATE / SKIP / DELETE / RENAME + the file_state bookkeeping.

`process_source` runs in the worker (async), so upserts return "added"/"updated"
to mean "queued for processing", and the adapter maps that to the wire `queued`.
"""

import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from surreal_commands import submit_command

from open_notebook.domain.notebook import Asset, Source
from open_notebook.domain.vault import VaultConnection, VaultFileState


def file_title(rel_path: str) -> str:
    """Derive a Source title from a vault-relative path; strip any extension."""
    base = os.path.basename(rel_path)
    stem, _ext = os.path.splitext(base)
    return stem or base


async def submit_process(
    source_id: str, content_state: Dict[str, Any], conn: VaultConnection
) -> None:
    """Queue the normal source pipeline for one file (disk or push content)."""
    submit_command(
        "open_notebook",
        "process_source",
        {
            "source_id": source_id,
            "content_state": content_state,
            "notebook_ids": [],
            "transformations": [str(t) for t in (conn.transformations or [])],
            "embed": bool(conn.embed),
        },
    )


async def vault_safe_delete(source: Source) -> None:
    """Delete a synced Source WITHOUT unlinking any underlying file on disk."""
    if source.asset:
        source.asset.file_path = None  # skip os.unlink in Source.delete()
    await source.delete()


async def apply_upsert(
    conn: VaultConnection,
    *,
    rel_path: str,
    content_state: Dict[str, Any],
    content_hash: str,
    mtime: float,
    size: int,
    notebook_ids: List[str],
    existing: Optional[VaultFileState] = None,
) -> Tuple[str, str]:
    """ADD / UPDATE / SKIP one file. Returns ``(action, source_id)`` where
    action is ``"added"`` | ``"updated"`` | ``"unchanged"``.

    Pass ``existing`` when the caller already has the file_state (avoids a
    lookup); otherwise it's resolved by ``(connection, rel_path)``.
    """
    if existing is None:
        existing = await VaultFileState.find(str(conn.id), rel_path)
    now = datetime.now()

    if existing is None:
        # ADD — new file: create the Source, queue processing, record state,
        # and attach to every subscribed notebook.
        source = Source(
            title=file_title(rel_path),
            asset=Asset(file_path=content_state.get("file_path")),
        )
        await source.save()
        await submit_process(str(source.id), content_state, conn)
        fs = VaultFileState(
            connection=str(conn.id),
            rel_path=rel_path,
            source=str(source.id),
            content_hash=content_hash,
            mtime=mtime,
            size=size,
            last_seen_at=now,
        )
        await fs.save()
        for nb in notebook_ids:
            await source.add_to_notebook(nb)
        return ("added", str(source.id))

    if existing.content_hash != content_hash:
        # UPDATE — re-process the existing source; subscribers stay attached.
        await submit_process(str(existing.source), content_state, conn)
        existing.content_hash = content_hash
        existing.mtime = mtime
        existing.size = size
        existing.last_seen_at = now
        await existing.save()
        return ("updated", str(existing.source))

    # SKIP — unchanged content; just touch last_seen_at.
    existing.last_seen_at = now
    await existing.save()
    return ("unchanged", str(existing.source))


async def apply_delete(conn: VaultConnection, rel_path: str) -> str:
    """Remove a file's Source (vault-safe) and its file_state. Returns
    ``"ok"`` or ``"missing"``."""
    fs = await VaultFileState.find(str(conn.id), rel_path)
    if fs is None:
        return "missing"
    try:
        source = await Source.get(str(fs.source))
        await vault_safe_delete(source)
    except Exception as e:
        logger.warning(f"Vault delete: source {fs.source} cleanup: {e}")
    await fs.delete()
    return "ok"


async def apply_rename(
    conn: VaultConnection,
    old_rel: str,
    new_rel: str,
    *,
    new_abs: Optional[str] = None,
    mtime: Optional[float] = None,
    size: Optional[int] = None,
) -> str:
    """Re-key the file_state and re-title the Source in place — same content, so
    NO re-process / re-embed. Returns ``"ok"`` or ``"missing"``.

    ``new_abs``/``mtime``/``size`` are disk-only (update the Asset path + the
    pre-filter fields); push renames omit them.
    """
    fs = await VaultFileState.find(str(conn.id), old_rel)
    if fs is None:
        return "missing"
    try:
        source = await Source.get(str(fs.source))
        if new_abs is not None:
            if source.asset:
                source.asset.file_path = new_abs
            else:
                source.asset = Asset(file_path=new_abs)
        source.title = file_title(new_rel)
        await source.save()
    except Exception as e:
        logger.warning(f"Vault rename: source {fs.source}: {e}")
    fs.rel_path = new_rel
    if mtime is not None:
        fs.mtime = mtime
    if size is not None:
        fs.size = size
    fs.last_seen_at = datetime.now()
    await fs.save()
    return "ok"


async def build_manifest(conn: VaultConnection) -> Dict[str, Dict[str, Any]]:
    """The server's view of a vault: ``{rel_path: {hash, mtime, size}}``, used
    by the plugin's reconcile diff to avoid re-uploading unchanged notes."""
    states = await VaultFileState.for_connection(str(conn.id))
    return {
        fs.rel_path: {"hash": fs.content_hash, "mtime": fs.mtime, "size": fs.size}
        for fs in states
    }
