"""Live filesystem watching for vault connections (Phase 5).

Hosted in the API process (single owner → no double-ingest). A watchdog
Observer watches each effectively-live connection's folder; events are
debounced per connection and turned into a targeted ``sync_vault`` job. The
**worker** does all extraction/embedding — the watcher only detects + submits.

Set ``OPEN_NOTEBOOK_VAULT_WATCHER=off`` to disable (e.g. when running multiple
API replicas, so only one process owns the watchers).
"""

import os
import threading
from typing import Dict, List, Optional

import pathspec
from loguru import logger
from surreal_commands import submit_command
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from open_notebook.domain.vault import VaultConnection, effective_is_live

# Quiet window before flushing an event burst. Obsidian writes temp files and
# fires multiple events per save, so we collapse them per connection.
DEBOUNCE_SECONDS = 1.8


def _rel(root: str, abs_path: str) -> str:
    return os.path.relpath(abs_path, root).replace(os.sep, "/")


class _VaultEventHandler(FileSystemEventHandler):
    """Debounces filesystem events for one connection into a single sync job.

    Runs entirely on watchdog's observer/timer threads. ``submit_command`` uses
    its own blocking DB connection, so it is safe to call from here.
    """

    def __init__(
        self,
        connection_id: str,
        root_path: str,
        include_globs: List[str],
        exclude_globs: List[str],
    ):
        self.connection_id = connection_id
        self.root_path = os.path.realpath(root_path)
        self._include = pathspec.PathSpec.from_lines("gitwildmatch", include_globs or [])
        self._exclude = pathspec.PathSpec.from_lines("gitwildmatch", exclude_globs or [])
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
        self._paths: set[str] = set()
        self._moves: List[dict] = []

    # -- classification ---------------------------------------------------
    def _safe_rel(self, abs_path: str) -> Optional[str]:
        try:
            rel = _rel(self.root_path, os.path.realpath(abs_path))
        except Exception:
            return None
        return None if rel.startswith("..") else rel

    def _included(self, rel: Optional[str]) -> bool:
        return bool(rel) and self._include.match_file(rel) and not self._exclude.match_file(rel)

    # -- events -----------------------------------------------------------
    def on_created(self, event):
        if not event.is_directory:
            self._queue_path(event.src_path)

    def on_modified(self, event):
        if not event.is_directory:
            self._queue_path(event.src_path)

    def on_deleted(self, event):
        if event.is_directory:
            return
        # The file is gone, so we can't apply include globs by content — only
        # honor the exclude list; the engine deletes it if it was tracked.
        rel = self._safe_rel(event.src_path)
        if rel and not self._exclude.match_file(rel):
            with self._lock:
                self._paths.add(rel)
            self._schedule()

    def on_moved(self, event):
        if event.is_directory:
            return
        src = self._safe_rel(event.src_path)
        dst = self._safe_rel(event.dest_path)
        src_ok = self._included(src)
        dst_ok = self._included(dst)
        with self._lock:
            if src_ok and dst_ok:
                self._moves.append({"from_rel": src, "to_rel": dst})
            elif dst_ok:
                self._paths.add(dst)  # moved into scope -> treat as add
            elif src_ok:
                self._paths.add(src)  # moved out of scope -> treat as delete
            else:
                return
        self._schedule()

    def _queue_path(self, abs_path: str):
        rel = self._safe_rel(abs_path)
        if self._included(rel):
            with self._lock:
                self._paths.add(rel)  # type: ignore[arg-type]
            self._schedule()

    # -- debounce + submit -----------------------------------------------
    def _schedule(self):
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(DEBOUNCE_SECONDS, self._flush)
            self._timer.daemon = True
            self._timer.start()

    def _flush(self):
        with self._lock:
            paths = sorted(self._paths)
            moves = list(self._moves)
            self._paths.clear()
            self._moves.clear()
            self._timer = None
        if not paths and not moves:
            return
        payload: Dict[str, object] = {"connection_id": self.connection_id}
        if paths:
            payload["rel_paths"] = paths
        if moves:
            payload["moves"] = moves
        try:
            submit_command("open_notebook", "sync_vault", payload)
            logger.info(
                f"Vault watch {self.connection_id}: submitted "
                f"{len(paths)} path(s), {len(moves)} move(s)"
            )
        except Exception as e:
            logger.error(f"Vault watch submit failed for {self.connection_id}: {e}")

    def cancel(self):
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None


class VaultWatcherManager:
    """Owns one watchdog Observer with a watch per effectively-live connection."""

    def __init__(self):
        self._observer: Optional[Observer] = None
        self._watches: Dict[str, dict] = {}  # connection_id -> {watch, handler, root}
        self._lock = threading.Lock()
        self._enabled = (
            os.environ.get("OPEN_NOTEBOOK_VAULT_WATCHER", "").lower() != "off"
        )

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def start(self):
        if not self._enabled:
            logger.info("Vault watcher disabled (OPEN_NOTEBOOK_VAULT_WATCHER=off)")
            return
        await self.reconcile()

    async def reconcile(self):
        """Make running watches match the set of effectively-live connections.

        Awaits all DB work first, then mutates observer state under the lock
        (never awaits while holding it).
        """
        if not self._enabled:
            return
        try:
            connections = await VaultConnection.get_all()
        except Exception as e:
            logger.error(f"Vault watcher reconcile: failed to load connections: {e}")
            return

        desired: Dict[str, VaultConnection] = {}
        for conn in connections:
            try:
                if await effective_is_live(conn) and os.path.isdir(conn.root_path):
                    desired[str(conn.id)] = conn
            except Exception:
                continue

        with self._lock:
            # Stop watches that are no longer wanted or whose root path changed.
            for cid in list(self._watches.keys()):
                conn = desired.get(cid)
                if conn is None or (
                    os.path.realpath(conn.root_path) != self._watches[cid]["root"]
                ):
                    self._stop_locked(cid)
            # Start watches for newly-live connections.
            for cid, conn in desired.items():
                if cid not in self._watches:
                    self._start_locked(conn)

    def _ensure_observer(self):
        if self._observer is None:
            self._observer = Observer()
            self._observer.start()

    def _start_locked(self, conn: VaultConnection):
        self._ensure_observer()
        root = os.path.realpath(conn.root_path)
        handler = _VaultEventHandler(
            str(conn.id), root, conn.include_globs, conn.exclude_globs
        )
        try:
            watch = self._observer.schedule(handler, root, recursive=True)  # type: ignore[union-attr]
        except Exception as e:
            logger.error(f"Vault watch failed to start for {conn.id} ({root}): {e}")
            return
        self._watches[str(conn.id)] = {"watch": watch, "handler": handler, "root": root}
        logger.info(f"Vault watch started: {conn.id} -> {root}")

    def _stop_locked(self, cid: str):
        w = self._watches.pop(cid, None)
        if not w:
            return
        try:
            w["handler"].cancel()
            if self._observer is not None:
                self._observer.unschedule(w["watch"])
        except Exception as e:
            logger.warning(f"Vault watch stop {cid}: {e}")
        logger.info(f"Vault watch stopped: {cid}")

    async def stop_connection(self, connection_id: str):
        with self._lock:
            self._stop_locked(connection_id)

    async def stop(self):
        with self._lock:
            for cid in list(self._watches.keys()):
                self._stop_locked(cid)
            obs = self._observer
            self._observer = None
        if obs is not None:
            try:
                obs.stop()
                obs.join(timeout=5)
            except Exception as e:
                logger.warning(f"Vault watcher observer shutdown error: {e}")

    def status(self) -> dict:
        with self._lock:
            return {"enabled": self._enabled, "watching": sorted(self._watches.keys())}


_manager: Optional[VaultWatcherManager] = None


def get_vault_watcher() -> VaultWatcherManager:
    global _manager
    if _manager is None:
        _manager = VaultWatcherManager()
    return _manager
