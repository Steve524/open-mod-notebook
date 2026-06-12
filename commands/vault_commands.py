# SHELVED: server-side disk vault sync; superseded by the notebook_obsidian
# push model. Gated by OPEN_NOTEBOOK_ENABLE_LOCAL_VAULTS (off by default) — the
# refresh endpoints and the filesystem watcher that submit this command are
# disabled, so `sync_vault` is inert unless local vaults are re-enabled. Kept,
# not deleted, for recoverability. The per-file appliers it calls live in
# commands/vault_engine.py and ARE shared with the (active) push path.
"""Vault sync engine — the `sync_vault` background command (disk driver).

Walks a connection's folder, runs a 3-way diff against `vault_file_state`, and
applies ADD/UPDATE/DELETE via the shared appliers. Runs in the worker (never
the API thread). `rel_paths` present = targeted single-file pass (live watch);
absent = full scan.
"""

import hashlib
import os
import time
from datetime import datetime
from typing import List, Optional

import pathspec
from loguru import logger
from pydantic import BaseModel
from surreal_commands import CommandInput, CommandOutput, command

from commands.vault_engine import apply_delete, apply_rename, apply_upsert
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


# SHELVED: disk walk — only runs when local vaults are enabled.
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


# SHELVED: disk hashing — only runs when local vaults are enabled.
def _hash_file(abs_path: str) -> str:
    """Hash raw bytes so changes to ANY file type (PDFs, docx, …) are detected.

    Reading as text was lossy for binaries; bytes are exact. Streamed in chunks
    to avoid loading large documents fully into memory.
    """
    h = hashlib.sha256()
    with open(abs_path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Command — the disk driver. Walks the folder + 3-way diff, then delegates the
# per-file ADD/UPDATE/DELETE/RENAME to the shared appliers in vault_engine.
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

        # Apply explicit renames first via the shared applier (same content, so
        # no re-process / re-embed). Disk supplies the new abs path + stat.
        if input_data.moves:
            for mv in input_data.moves:
                new_abs = os.path.join(conn.root_path, mv.to_rel.replace("/", os.sep))
                st = None
                try:
                    st = os.stat(new_abs)
                except OSError:
                    pass
                result = await apply_rename(
                    conn,
                    mv.from_rel,
                    mv.to_rel,
                    new_abs=new_abs,
                    mtime=st.st_mtime if st else None,
                    size=st.st_size if st else None,
                )
                if result == "ok":
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

            prev = await VaultFileState.find(str(conn.id), rel_path)
            # Pre-filter with mtime+size to skip hashing unchanged files.
            if prev and prev.mtime == st.st_mtime and prev.size == st.st_size:
                prev.last_seen_at = datetime.now()
                await prev.save()
                stats["skipped"] += 1
                continue

            content_hash = _hash_file(abs_path)
            action, _src = await apply_upsert(
                conn,
                rel_path=rel_path,
                content_state={"file_path": abs_path, "delete_source": False},
                content_hash=content_hash,
                mtime=st.st_mtime,
                size=st.st_size,
                notebook_ids=notebook_ids,
                existing=prev,
            )
            if action == "added":
                stats["added"] += 1
            elif action == "updated":
                stats["updated"] += 1
            else:
                stats["skipped"] += 1

        # DELETE: a full scan removes every unseen row; a targeted pass only
        # removes the explicitly-named paths that are now missing on disk.
        for fs in await VaultFileState.for_connection(str(conn.id)):
            if fs.rel_path in seen:
                continue
            if targeted is not None and fs.rel_path not in targeted:
                continue
            if await apply_delete(conn, fs.rel_path) == "ok":
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
