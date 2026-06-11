"""Vault sync endpoints (Phase 1).

Connections are a workspace resource; subscriptions tie a notebook to a
connection. Refresh endpoints submit `sync_vault` jobs and return job ids — they
never block on a scan. "Remove link" (DELETE connection) is the only place a
connection is deleted; "Unsubscribe" only detaches one notebook.
"""

import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from pydantic import BaseModel, Field
from surreal_commands import submit_command

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Source
from open_notebook.domain.vault import (
    DEFAULT_EXCLUDE_GLOBS,
    DEFAULT_INCLUDE_GLOBS,
    SUPPORTED_EXTENSIONS,
    VaultConnection,
    VaultFileState,
    VaultSubscription,
    is_supported_file,
)

# Import so the sync_vault command is registered in the API process registry.
import commands.vault_commands  # noqa: F401
from api.vault_watcher import get_vault_watcher

router = APIRouter()


async def _reconcile_watchers() -> None:
    """Re-sync live-mode observers after a change that may affect them."""
    try:
        await get_vault_watcher().reconcile()
    except Exception as e:  # never let watcher upkeep break an API call
        logger.warning(f"Vault watcher reconcile failed: {e}")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class VaultConnectionCreate(BaseModel):
    name: str
    root_path: str
    sync_mode: str = "inherit"
    include_globs: Optional[List[str]] = None
    exclude_globs: Optional[List[str]] = None
    embed: bool = True
    transformations: List[str] = Field(default_factory=list)


class VaultConnectionUpdate(BaseModel):
    name: Optional[str] = None
    root_path: Optional[str] = None
    sync_mode: Optional[str] = None
    include_globs: Optional[List[str]] = None
    exclude_globs: Optional[List[str]] = None
    embed: Optional[bool] = None
    transformations: Optional[List[str]] = None


class VaultConnectionResponse(BaseModel):
    id: str
    name: str
    root_path: str
    sync_mode: str
    include_globs: List[str]
    exclude_globs: List[str]
    embed: bool
    status: str
    last_synced_at: Optional[str] = None
    last_error: Optional[str] = None
    stats: Optional[dict] = None
    subscriber_count: int = 0
    file_count: int = 0
    created: Optional[str] = None
    updated: Optional[str] = None


class SubscribeRequest(BaseModel):
    connection_id: str


class VaultSubscriptionResponse(BaseModel):
    id: str
    connection_id: str
    connection: VaultConnectionResponse


class ValidatePathRequest(BaseModel):
    root_path: str


class ValidatePathResponse(BaseModel):
    exists: bool
    readable: bool
    is_dir: bool
    allowed: bool = True
    file_count_estimate: int = 0
    sample: List[str] = Field(default_factory=list)


class VaultJobResponse(BaseModel):
    job_ids: List[str]
    status: str = "submitted"


class BrowseEntry(BaseModel):
    name: str
    path: str
    doc_count: int = 0  # shallow count of ingestable children (a "this is a vault" hint)


class BrowseResponse(BaseModel):
    path: str
    parent: Optional[str] = None  # None when at the allowlist/filesystem root
    allowed: bool = True
    entries: List[BrowseEntry]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _allowed_base() -> Optional[str]:
    base = os.environ.get("OPEN_NOTEBOOK_VAULTS_BASE_DIR")
    return base.strip() if base and base.strip() else None


def _is_allowed(root_path: str) -> bool:
    base = _allowed_base()
    if not base:
        return True
    try:
        return (
            os.path.commonpath([os.path.realpath(root_path), os.path.realpath(base)])
            == os.path.realpath(base)
        )
    except Exception:
        return False


def _require_allowed(root_path: str) -> None:
    if not _is_allowed(root_path):
        raise HTTPException(
            status_code=400,
            detail="Path is outside the allowed vaults base directory (OPEN_NOTEBOOK_VAULTS_BASE_DIR)",
        )


def _default_browse_root() -> str:
    """Where the folder browser starts when no path is given."""
    base = _allowed_base()
    if base:
        return os.path.realpath(base)
    for candidate in ("/vaults", os.path.expanduser("~")):
        if candidate and os.path.isdir(candidate):
            return os.path.realpath(candidate)
    return os.path.realpath(os.sep)


def _shallow_doc_count(directory: str, cap: int = 200) -> int:
    """Count direct ingestable children (cheap hint; not recursive)."""
    count = 0
    try:
        with os.scandir(directory) as it:
            for entry in it:
                if entry.is_file() and is_supported_file(entry.name):
                    count += 1
                    if count >= cap:
                        break
    except OSError:
        return 0
    return count


async def _counts(connection_id: str) -> tuple[int, int]:
    subs = await VaultSubscription.for_connection(connection_id)
    files = await VaultFileState.for_connection(connection_id)
    return len(subs), len(files)


def _conn_response(
    conn: VaultConnection, subscriber_count: int, file_count: int
) -> VaultConnectionResponse:
    return VaultConnectionResponse(
        id=str(conn.id or ""),
        name=conn.name,
        root_path=conn.root_path,
        sync_mode=conn.sync_mode,
        include_globs=conn.include_globs,
        exclude_globs=conn.exclude_globs,
        embed=conn.embed,
        status=conn.status,
        last_synced_at=str(conn.last_synced_at) if conn.last_synced_at else None,
        last_error=conn.last_error,
        stats=conn.stats,
        subscriber_count=subscriber_count,
        file_count=file_count,
        created=str(conn.created) if conn.created else None,
        updated=str(conn.updated) if conn.updated else None,
    )


def _apply_create(data: VaultConnectionCreate) -> VaultConnection:
    return VaultConnection(
        name=data.name,
        root_path=data.root_path,
        sync_mode=data.sync_mode or "inherit",
        include_globs=data.include_globs or list(DEFAULT_INCLUDE_GLOBS),
        exclude_globs=data.exclude_globs or list(DEFAULT_EXCLUDE_GLOBS),
        embed=data.embed,
        transformations=data.transformations or [],
    )


# ---------------------------------------------------------------------------
# Connections (workspace resource)
# ---------------------------------------------------------------------------
@router.get("/vault-connections", response_model=List[VaultConnectionResponse])
async def list_connections():
    conns = await VaultConnection.get_all(order_by="name asc")
    out = []
    for conn in conns:
        sc, fc = await _counts(str(conn.id))
        out.append(_conn_response(conn, sc, fc))
    return out


@router.post("/vault-connections", response_model=VaultConnectionResponse)
async def create_connection(body: VaultConnectionCreate):
    _require_allowed(body.root_path)
    conn = _apply_create(body)
    await conn.save()
    await _reconcile_watchers()
    return _conn_response(conn, 0, 0)


@router.patch("/vault-connections/{connection_id}", response_model=VaultConnectionResponse)
async def update_connection(connection_id: str, body: VaultConnectionUpdate):
    conn = await VaultConnection.get(connection_id)
    if body.root_path is not None:
        _require_allowed(body.root_path)
    for field in (
        "name",
        "root_path",
        "sync_mode",
        "include_globs",
        "exclude_globs",
        "embed",
        "transformations",
    ):
        val = getattr(body, field)
        if val is not None:
            setattr(conn, field, val)
    await conn.save()
    await _reconcile_watchers()  # mode/path change may start/stop a watcher
    sc, fc = await _counts(connection_id)
    return _conn_response(conn, sc, fc)


@router.delete("/vault-connections/{connection_id}")
async def remove_link(connection_id: str, purge_sources: bool = Query(False)):
    """REMOVE LINK — delete the connection (Sources page only). Affects all subscribers."""
    conn = await VaultConnection.get(connection_id)
    files = await VaultFileState.for_connection(connection_id)
    purged = 0
    for fs in files:
        if purge_sources:
            try:
                source = await Source.get(str(fs.source))
                if source.asset:
                    source.asset.file_path = None  # never unlink the user's file
                await source.delete()
                purged += 1
            except Exception as e:
                logger.warning(f"Remove link: source {fs.source} cleanup: {e}")
        await fs.delete()
    for sub in await VaultSubscription.for_connection(connection_id):
        await sub.delete()
    await conn.delete()
    await get_vault_watcher().stop_connection(connection_id)
    return {"deleted": True, "purged_sources": purged}


# ---------------------------------------------------------------------------
# Subscriptions (notebook <-> connection)
# ---------------------------------------------------------------------------
@router.get(
    "/notebooks/{notebook_id}/vault-subscriptions",
    response_model=List[VaultSubscriptionResponse],
)
async def list_subscriptions(notebook_id: str):
    subs = await VaultSubscription.for_notebook(notebook_id)
    out = []
    for sub in subs:
        conn = await VaultConnection.get(str(sub.connection))
        sc, fc = await _counts(str(conn.id))
        out.append(
            VaultSubscriptionResponse(
                id=str(sub.id or ""),
                connection_id=str(sub.connection),
                connection=_conn_response(conn, sc, fc),
            )
        )
    return out


async def _backfill_subscription(notebook_id: str, connection_id: str) -> None:
    """Attach every existing source of the connection to the notebook (metadata only)."""
    files = await VaultFileState.for_connection(connection_id)
    for fs in files:
        try:
            await repo_query(
                "RELATE $source->reference->$nb",
                {"source": ensure_record_id(str(fs.source)), "nb": ensure_record_id(notebook_id)},
            )
        except Exception as e:
            logger.warning(f"Backfill attach {fs.source}->{notebook_id}: {e}")


@router.post(
    "/notebooks/{notebook_id}/vault-subscriptions",
    response_model=VaultSubscriptionResponse,
)
async def subscribe(notebook_id: str, body: SubscribeRequest):
    conn = await VaultConnection.get(body.connection_id)
    existing = await VaultSubscription.find(notebook_id, body.connection_id)
    if existing:
        sub = existing
    else:
        sub = VaultSubscription(notebook=notebook_id, connection=body.connection_id)
        await sub.save()
        await _backfill_subscription(notebook_id, body.connection_id)
    sc, fc = await _counts(str(conn.id))
    return VaultSubscriptionResponse(
        id=str(sub.id or ""),
        connection_id=str(conn.id),
        connection=_conn_response(conn, sc, fc),
    )


@router.delete("/notebooks/{notebook_id}/vault-subscriptions/{subscription_id}")
async def unsubscribe(notebook_id: str, subscription_id: str):
    """UNSUBSCRIBE — detach only this notebook; leave the connection/sources/others intact."""
    sub = await VaultSubscription.get(subscription_id)
    connection_id = str(sub.connection)
    # Detach this notebook's edges to the connection's sources.
    files = await VaultFileState.for_connection(connection_id)
    for fs in files:
        try:
            await repo_query(
                "DELETE reference WHERE in = $source AND out = $nb",
                {"source": ensure_record_id(str(fs.source)), "nb": ensure_record_id(notebook_id)},
            )
        except Exception as e:
            logger.warning(f"Unsubscribe detach {fs.source}: {e}")
    await sub.delete()
    return {"unsubscribed": True}


@router.post("/notebooks/{notebook_id}/vault/link", response_model=VaultConnectionResponse)
async def link_vault(notebook_id: str, body: VaultConnectionCreate):
    """Create a connection, subscribe this notebook, and kick off the first sync."""
    _require_allowed(body.root_path)
    conn = _apply_create(body)
    await conn.save()
    sub = VaultSubscription(notebook=notebook_id, connection=str(conn.id))
    await sub.save()
    submit_command("open_notebook", "sync_vault", {"connection_id": str(conn.id)})
    await _reconcile_watchers()
    return _conn_response(conn, 1, 0)


# ---------------------------------------------------------------------------
# Refresh (submit sync_vault jobs; never block)
# ---------------------------------------------------------------------------
@router.post("/notebooks/{notebook_id}/vault/refresh", response_model=VaultJobResponse)
async def refresh_notebook_vaults(notebook_id: str):
    subs = await VaultSubscription.for_notebook(notebook_id)
    job_ids = []
    for sub in subs:
        jid = submit_command(
            "open_notebook", "sync_vault", {"connection_id": str(sub.connection)}
        )
        job_ids.append(str(jid))
    return VaultJobResponse(job_ids=job_ids)


@router.post("/vault-connections/refresh-all", response_model=VaultJobResponse)
async def refresh_all():
    conns = await VaultConnection.get_all()
    job_ids = [
        str(submit_command("open_notebook", "sync_vault", {"connection_id": str(c.id)}))
        for c in conns
    ]
    return VaultJobResponse(job_ids=job_ids)


@router.post("/vault-connections/{connection_id}/refresh", response_model=VaultJobResponse)
async def refresh_one(connection_id: str):
    await VaultConnection.get(connection_id)  # 404 if missing
    jid = submit_command("open_notebook", "sync_vault", {"connection_id": connection_id})
    return VaultJobResponse(job_ids=[str(jid)])


@router.get("/vault-connections/{connection_id}/status")
async def connection_status(connection_id: str):
    conn = await VaultConnection.get(connection_id)
    return {
        "status": conn.status,
        "last_synced_at": str(conn.last_synced_at) if conn.last_synced_at else None,
        "last_error": conn.last_error,
        "stats": conn.stats,
    }


# ---------------------------------------------------------------------------
# Live-watch lifecycle (effective only when mode resolves to live)
# ---------------------------------------------------------------------------
@router.post("/vault-connections/{connection_id}/watch/start")
async def watch_start(connection_id: str):
    """Start watching this connection if its effective mode is live."""
    await VaultConnection.get(connection_id)  # 404 if missing
    await _reconcile_watchers()
    return get_vault_watcher().status()


@router.post("/vault-connections/{connection_id}/watch/stop")
async def watch_stop(connection_id: str):
    """Stop watching this connection until the next reconcile."""
    await VaultConnection.get(connection_id)  # 404 if missing
    await get_vault_watcher().stop_connection(connection_id)
    return get_vault_watcher().status()


# ---------------------------------------------------------------------------
# UI helper
# ---------------------------------------------------------------------------
class SupportedExtensionsResponse(BaseModel):
    extensions: List[str]
    include_globs: List[str]
    exclude_globs: List[str]


@router.get("/vault/supported-extensions", response_model=SupportedExtensionsResponse)
async def supported_extensions():
    """The canonical set of ingestable file types + the default globs.

    The frontend prefills the Add-a-vault dialog from this, so backend and
    frontend can't drift on what "all supported types" means.
    """
    return SupportedExtensionsResponse(
        extensions=list(SUPPORTED_EXTENSIONS),
        include_globs=list(DEFAULT_INCLUDE_GLOBS),
        exclude_globs=list(DEFAULT_EXCLUDE_GLOBS),
    )


@router.post("/vault/validate-path", response_model=ValidatePathResponse)
async def validate_path(body: ValidatePathRequest):
    p = Path(body.root_path)
    exists = p.exists()
    is_dir = p.is_dir()
    readable = os.access(body.root_path, os.R_OK) if exists else False
    allowed = _is_allowed(body.root_path)
    count = 0
    sample: List[str] = []
    if exists and is_dir and readable and allowed:
        try:
            for dirpath, _dirnames, filenames in os.walk(body.root_path):
                for name in filenames:
                    if is_supported_file(name):
                        count += 1
                        if len(sample) < 10:
                            rel = os.path.relpath(
                                os.path.join(dirpath, name), body.root_path
                            )
                            sample.append(rel.replace(os.sep, "/"))
                if count > 5000:  # soft cap for the estimate
                    break
        except Exception as e:
            logger.warning(f"validate-path walk error: {e}")
    return ValidatePathResponse(
        exists=exists,
        readable=readable,
        is_dir=is_dir,
        allowed=allowed,
        file_count_estimate=count,
        sample=sample,
    )


@router.get("/vault/browse", response_model=BrowseResponse)
async def browse(path: Optional[str] = Query(None)):
    """List sub-directories so the UI can browse the SERVER's filesystem.

    The server reads the vault, so users pick a folder the server can see
    (in Docker, that's the in-container path). Honors the optional
    OPEN_NOTEBOOK_VAULTS_BASE_DIR allowlist as a hard navigation boundary.
    """
    base = _allowed_base()
    target = os.path.realpath(path.strip()) if path and path.strip() else _default_browse_root()

    if not os.path.isdir(target):
        raise HTTPException(status_code=400, detail="Not a directory")
    # Confine navigation to the allowlist when one is configured.
    if base and not _is_allowed(target):
        target = os.path.realpath(base)

    parent: Optional[str] = os.path.dirname(target)
    if parent == target:  # filesystem root
        parent = None
    elif base and os.path.realpath(target) == os.path.realpath(base):
        parent = None  # don't let the user climb above the allowlist root
    elif base and parent and not _is_allowed(parent):
        parent = os.path.realpath(base)

    entries: List[BrowseEntry] = []
    try:
        for name in sorted(os.listdir(target), key=str.lower):
            if name.startswith("."):  # skip hidden dirs (.obsidian, .git, .trash …)
                continue
            full = os.path.join(target, name)
            if os.path.isdir(full):
                entries.append(
                    BrowseEntry(name=name, path=full, doc_count=_shallow_doc_count(full))
                )
    except PermissionError:
        raise HTTPException(status_code=400, detail="Permission denied reading directory")

    return BrowseResponse(
        path=target, parent=parent, allowed=_is_allowed(target), entries=entries
    )
