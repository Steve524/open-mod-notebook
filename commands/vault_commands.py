"""Vault sync engine — the `sync_vault` background command.

Walks a connection's folder, runs a 3-way diff against `vault_file_state`, and
applies ADD/UPDATE/DELETE by reusing the normal source pipeline (`process_source`).
Runs in the worker (never the API thread). `rel_paths` present = targeted
single-file pass (live watch); absent = full scan.
"""

import hashlib
import os
import time
from datetime import datetime
from typing import List, Optional

import pathspec
from loguru import logger
from pydantic import BaseModel
from surreal_commands import CommandInput, CommandOutput, command, submit_command

from open_notebook.domain.notebook import Asset, Source
from open_notebook.domain.vault import (
    VaultConnection,
    VaultFileState,
    VaultSubscription,
    effective_is_live,
)
from open_notebook.exceptions import ConfigurationError


class MoveOp(BaseModel):
    """A file rename detected by the live watcher (same content, new path)."""

    from_rel: str
    to_rel: str


class SyncVaultInput(CommandInput):
    connection_id: str
    rel_paths: Optional[List[str]] = None  # present = targeted pass (live watch)
    moves: Optional[List[MoveOp]] = None  # explicit renames (no re-embed)


class SyncVaultOutput(CommandOutput):
    success: bool
    connection_id: str
    files: int = 0
    added: int = 0
    updated: int = 0
    removed: int = 0
    skipped: int = 0
    processing_time: float = 0.0
    error_message: Optional[str] = None


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------
def _build_spec(globs: List[str]) -> pathspec.PathSpec:
    return pathspec.PathSpec.from_lines("gitwildmatch", globs or [])


def _iter_files(root: str, include: pathspec.PathSpec, exclude: pathspec.PathSpec):
    """Yield (rel_path, abs_path) for files matching include and not exclude."""
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune excluded directories early for speed.
        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir != "." and exclude.match_file(rel_dir + "/"):
            dirnames[:] = []
            continue
        for name in filenames:
            abs_path = os.path.join(dirpath, name)
            rel_path = os.path.relpath(abs_path, root).replace(os.sep, "/")
            if not include.match_file(rel_path):
                continue
            if exclude.match_file(rel_path):
                continue
            yield rel_path, abs_path


def _hash_text(abs_path: str) -> str:
    with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
        return hashlib.sha256(f.read().encode("utf-8")).hexdigest()


def _file_title(rel_path: str) -> str:
    base = os.path.basename(rel_path)
    return base[:-3] if base.lower().endswith(".md") else base


# ---------------------------------------------------------------------------
# Apply operations
# ---------------------------------------------------------------------------
async def _submit_process(source_id: str, abs_path: str, conn: VaultConnection):
    submit_command(
        "open_notebook",
        "process_source",
        {
            "source_id": source_id,
            "content_state": {"file_path": abs_path, "delete_source": False},
            "notebook_ids": [],
            "transformations": [str(t) for t in (conn.transformations or [])],
            "embed": bool(conn.embed),
        },
    )


async def _vault_safe_delete(source: Source) -> None:
    """Delete a synced Source WITHOUT unlinking the user's vault file on disk."""
    if source.asset:
        source.asset.file_path = None  # skip os.unlink in Source.delete()
    await source.delete()


# ---------------------------------------------------------------------------
# Command
# ---------------------------------------------------------------------------
@command(
    "sync_vault",
    app="open_notebook",
    retry={
        "max_attempts": 15,
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 120,
        "stop_on": [ValueError, ConfigurationError],
        "retry_log_level": "debug",
    },
)
async def sync_vault_command(input_data: SyncVaultInput) -> SyncVaultOutput:
    start = time.time()
    conn = await VaultConnection.get(input_data.connection_id)
    if not conn:
        raise ValueError(f"Vault connection '{input_data.connection_id}' not found")

    # A targeted pass names specific files (live watch); absent = full scan.
    is_targeted = bool(input_data.rel_paths) or bool(input_data.moves)

    # Per-connection lock: a full scan in progress collapses queued refreshes.
    if not is_targeted and conn.status == "scanning":
        logger.info(f"Vault {conn.id} already scanning; collapsing this refresh")
        return SyncVaultOutput(success=True, connection_id=str(conn.id))

    run_start = datetime.now()
    stats = {"added": 0, "updated": 0, "removed": 0, "skipped": 0, "files": 0}
    if not is_targeted:
        conn.status = "scanning"
        conn.last_error = None
        await conn.save()

    try:
        if not os.path.isdir(conn.root_path):
            raise ValueError(f"Vault root_path not found or not a directory: {conn.root_path}")

        include = _build_spec(conn.include_globs)
        exclude = _build_spec(conn.exclude_globs)
        subscribers = await VaultSubscription.for_connection(str(conn.id))
        notebook_ids = [str(s.notebook) for s in subscribers]

        existing = {fs.rel_path: fs for fs in await VaultFileState.for_connection(str(conn.id))}

        # Apply explicit renames first: re-key the file_state and re-title the
        # Source in place. Same content, so we never re-process or re-embed.
        if input_data.moves:
            for mv in input_data.moves:
                prev = existing.get(mv.from_rel)
                if prev is None:
                    continue  # unknown source; the dest is handled as a normal add
                new_abs = os.path.join(conn.root_path, mv.to_rel.replace("/", os.sep))
                try:
                    source = await Source.get(str(prev.source))
                    if source.asset:
                        source.asset.file_path = new_abs
                    else:
                        source.asset = Asset(file_path=new_abs)
                    source.title = _file_title(mv.to_rel)
                    await source.save()
                except Exception as e:
                    logger.warning(f"Vault move: source {prev.source} re-title: {e}")
                del existing[mv.from_rel]
                prev.rel_path = mv.to_rel
                try:
                    st = os.stat(new_abs)
                    prev.mtime = st.st_mtime
                    prev.size = st.st_size
                except OSError:
                    pass
                prev.last_seen_at = datetime.now()
                await prev.save()
                existing[mv.to_rel] = prev
                stats["updated"] += 1

        # Restrict the walk to specific files for a targeted (live) pass.
        targeted = set(input_data.rel_paths or []) if is_targeted else None

        seen: set[str] = set()
        for rel_path, abs_path in _iter_files(conn.root_path, include, exclude):
            if targeted is not None and rel_path not in targeted:
                continue
            seen.add(rel_path)
            stats["files"] += 1
            try:
                st = os.stat(abs_path)
            except OSError as e:
                logger.warning(f"Cannot stat {abs_path}: {e}")
                stats["skipped"] += 1
                continue
            prev = existing.get(rel_path)

            # Pre-filter with mtime+size to skip hashing unchanged files.
            if prev and prev.mtime == st.st_mtime and prev.size == st.st_size:
                prev.last_seen_at = datetime.now()
                await prev.save()
                stats["skipped"] += 1
                continue

            content_hash = _hash_text(abs_path)

            if prev is None:
                # ADD
                source = Source(
                    title=_file_title(rel_path),
                    asset=Asset(file_path=abs_path),
                )
                await source.save()
                await _submit_process(str(source.id), abs_path, conn)
                fs = VaultFileState(
                    connection=str(conn.id),
                    rel_path=rel_path,
                    source=str(source.id),
                    content_hash=content_hash,
                    mtime=st.st_mtime,
                    size=st.st_size,
                    last_seen_at=datetime.now(),
                )
                await fs.save()
                for nb in notebook_ids:
                    await source.add_to_notebook(nb)
                stats["added"] += 1
            elif prev.content_hash != content_hash:
                # UPDATE — re-process the existing source; subscribers stay attached.
                await _submit_process(str(prev.source), abs_path, conn)
                prev.content_hash = content_hash
                prev.mtime = st.st_mtime
                prev.size = st.st_size
                prev.last_seen_at = datetime.now()
                await prev.save()
                stats["updated"] += 1
            else:
                prev.last_seen_at = datetime.now()
                await prev.save()
                stats["skipped"] += 1

        # DELETE: a full scan removes every unseen row; a targeted pass only
        # removes the explicitly-named paths that are now missing on disk.
        if targeted is None:
            to_delete = [(rp, fs) for rp, fs in existing.items() if rp not in seen]
        else:
            to_delete = [
                (rp, fs)
                for rp, fs in existing.items()
                if rp in targeted and rp not in seen
            ]
        for rel_path, fs in to_delete:
            try:
                source = await Source.get(str(fs.source))
                await _vault_safe_delete(source)
            except Exception as e:
                logger.warning(f"Vault delete: source {fs.source} cleanup: {e}")
            await fs.delete()
            stats["removed"] += 1

        # Finalize connection state.
        conn.stats = stats
        conn.last_synced_at = datetime.now()
        conn.last_error = None
        conn.status = "watching" if await effective_is_live(conn) else "idle"
        await conn.save()

        logger.info(
            f"sync_vault {conn.id}: files={stats['files']} +{stats['added']} "
            f"~{stats['updated']} -{stats['removed']} skip={stats['skipped']}"
        )
        return SyncVaultOutput(
            success=True,
            connection_id=str(conn.id),
            files=stats["files"],
            added=stats["added"],
            updated=stats["updated"],
            removed=stats["removed"],
            skipped=stats["skipped"],
            processing_time=time.time() - start,
        )

    except ValueError as e:
        conn.status = "error"
        conn.last_error = str(e)
        await conn.save()
        logger.error(f"sync_vault failed for {conn.id}: {e}")
        return SyncVaultOutput(
            success=False,
            connection_id=str(conn.id),
            processing_time=time.time() - start,
            error_message=str(e),
        )
    except Exception as e:
        conn.status = "error"
        conn.last_error = str(e)
        await conn.save()
        logger.debug(f"sync_vault transient error for {conn.id}: {e}")
        raise
