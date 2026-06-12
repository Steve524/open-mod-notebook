"""Obsidian plugin adapter — the wire contract the forked plugin speaks.

Registered at prefix ``/api/v1`` so routes resolve to ``/api/v1/obsidian/*`` and
``/api/v1/searchspaces/``. Each endpoint delegates the real work to the shared
appliers in ``commands/vault_engine.py``; this module only translates between
the plugin's wire shapes and those appliers. IDs are Open Notebook string
record ids (the plugin uses string ids — see Phase 5).

Auth: ``PasswordAuthMiddleware`` gates these paths automatically (``Bearer`` =
the app password) when ``OPEN_NOTEBOOK_PASSWORD`` is set; ``/health`` therefore
doubles as the plugin's token check.
TODO(auth-upgrade): a dedicated hashed Obsidian token would hook in here.
"""

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from api.obsidian_models import (
    ConnectRequest,
    ConnectResponse,
    DeleteAck,
    DeleteAckItem,
    DeleteRequest,
    HealthResponse,
    ManifestEntry,
    ManifestResponse,
    RenameAck,
    RenameAckItem,
    RenameRequest,
    SearchSpace,
    SyncAck,
    SyncAckItem,
    SyncRequest,
)
from commands.vault_engine import (
    apply_delete,
    apply_rename,
    apply_upsert,
    build_manifest,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook
from open_notebook.domain.vault import (
    VaultConnection,
    VaultFileState,
    VaultSubscription,
)

router = APIRouter()

# Implemented capabilities; the plugin feature-detects from this. "attachments"
# is intentionally omitted in v1.
CAPS = ["sync", "rename", "delete", "manifest"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _require_conn(vault_id: str) -> VaultConnection:
    """Resolve a push connection by vault_id, or 404 VAULT_NOT_REGISTERED so the
    plugin reconnects (its api-client treats that code as a transient retry)."""
    conn = await VaultConnection.get_by_vault_id(vault_id)
    if conn is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "VAULT_NOT_REGISTERED",
                "message": f"Vault '{vault_id}' is not registered; reconnect.",
            },
        )
    return conn


async def _notebook_ids(conn: VaultConnection) -> List[str]:
    subs = await VaultSubscription.for_connection(str(conn.id))
    return [str(s.notebook) for s in subs]


# ---------------------------------------------------------------------------
# Health + search spaces (notebooks)
# ---------------------------------------------------------------------------
@router.get("/obsidian/health", response_model=HealthResponse)
async def health():
    return HealthResponse(capabilities=CAPS, server_time_utc=_now())


@router.get("/searchspaces/", response_model=List[SearchSpace])
async def search_spaces():
    """Attach targets for the plugin = Open Notebook notebooks."""
    notebooks = await Notebook.get_all(order_by="name asc")
    return [
        SearchSpace(id=str(nb.id), name=nb.name, description=nb.description)
        for nb in notebooks
    ]


# ---------------------------------------------------------------------------
# Connect (idempotent registration + subscription)
# ---------------------------------------------------------------------------
@router.post("/obsidian/connect", response_model=ConnectResponse)
async def connect(body: ConnectRequest):
    conn = await VaultConnection.get_by_vault_id(body.vault_id)
    if conn is None and body.vault_fingerprint:
        conn = await VaultConnection.get_by_fingerprint(body.vault_fingerprint)

    if conn is None:
        conn = VaultConnection(
            name=body.vault_name or "Obsidian Vault",
            kind="push",
            vault_id=body.vault_id,
            vault_fingerprint=body.vault_fingerprint or None,
        )
        await conn.save()
    else:
        # Found by fingerprint on a new device, or re-connecting: keep identity fresh.
        changed = False
        if not conn.vault_id and body.vault_id:
            conn.vault_id = body.vault_id
            changed = True
        if body.vault_name and conn.name != body.vault_name:
            conn.name = body.vault_name
            changed = True
        if changed:
            await conn.save()

    # Idempotent subscription (unique index also guards it).
    existing = await VaultSubscription.find(body.search_space_id, str(conn.id))
    if existing is None:
        sub = VaultSubscription(
            notebook=body.search_space_id, connection=str(conn.id)
        )
        await sub.save()
        await _backfill_notebook(str(conn.id), body.search_space_id)

    return ConnectResponse(
        connector_id=str(conn.id),
        vault_id=body.vault_id,
        search_space_id=body.search_space_id,
        capabilities=CAPS,
        server_time_utc=_now(),
    )


async def _backfill_notebook(connection_id: str, notebook_id: str) -> None:
    """Attach every existing source of the vault to a newly-subscribed notebook,
    so a second notebook reuses sources without any re-push/re-embed."""
    for fs in await VaultFileState.for_connection(connection_id):
        try:
            await repo_query(
                "RELATE $s->reference->$nb",
                {
                    "s": ensure_record_id(str(fs.source)),
                    "nb": ensure_record_id(notebook_id),
                },
            )
        except Exception as e:
            logger.warning(f"obsidian backfill {fs.source}->{notebook_id}: {e}")


# ---------------------------------------------------------------------------
# Sync / rename / delete / manifest
# ---------------------------------------------------------------------------
@router.post("/obsidian/sync", response_model=SyncAck)
async def sync(body: SyncRequest):
    conn = await _require_conn(body.vault_id)
    notebook_ids = await _notebook_ids(conn)
    items: List[SyncAckItem] = []
    indexed = 0
    failed = 0
    for note in body.notes:
        if note.is_binary:
            items.append(
                SyncAckItem(
                    path=note.path,
                    status="error",
                    error="binary attachments not supported in v1",
                )
            )
            failed += 1
            continue
        try:
            action, source_id = await apply_upsert(
                conn,
                rel_path=note.path,
                content_state={"content": note.content},
                content_hash=note.content_hash,
                mtime=note.mtime,
                size=note.size,
                notebook_ids=notebook_ids,
            )
            # process_source is async -> added/updated report as "queued".
            status = "ok" if action == "unchanged" else "queued"
            items.append(
                SyncAckItem(path=note.path, status=status, document_id=source_id)
            )
            indexed += 1
        except Exception as e:
            logger.warning(f"obsidian sync {note.path}: {e}")
            items.append(
                SyncAckItem(path=note.path, status="error", error=str(e)[:200])
            )
            failed += 1
    return SyncAck(
        vault_id=body.vault_id, indexed=indexed, failed=failed, items=items
    )


@router.post("/obsidian/rename", response_model=RenameAck)
async def rename(body: RenameRequest):
    conn = await _require_conn(body.vault_id)
    items: List[RenameAckItem] = []
    renamed = 0
    missing = 0
    for pair in body.renames:
        try:
            res = await apply_rename(conn, pair.old_path, pair.new_path)
            items.append(
                RenameAckItem(
                    old_path=pair.old_path, new_path=pair.new_path, status=res
                )
            )
            if res == "ok":
                renamed += 1
            else:
                missing += 1
        except Exception as e:
            logger.warning(f"obsidian rename {pair.old_path}->{pair.new_path}: {e}")
            items.append(
                RenameAckItem(
                    old_path=pair.old_path,
                    new_path=pair.new_path,
                    status="error",
                    error=str(e)[:200],
                )
            )
    return RenameAck(
        vault_id=body.vault_id, renamed=renamed, missing=missing, items=items
    )


@router.delete("/obsidian/notes", response_model=DeleteAck)
async def delete_notes(body: DeleteRequest):
    conn = await _require_conn(body.vault_id)
    items: List[DeleteAckItem] = []
    deleted = 0
    missing = 0
    for path in body.paths:
        try:
            res = await apply_delete(conn, path)
            items.append(DeleteAckItem(path=path, status=res))
            if res == "ok":
                deleted += 1
            else:
                missing += 1
        except Exception as e:
            logger.warning(f"obsidian delete {path}: {e}")
            items.append(DeleteAckItem(path=path, status="error", error=str(e)[:200]))
    return DeleteAck(
        vault_id=body.vault_id, deleted=deleted, missing=missing, items=items
    )


@router.get("/obsidian/manifest", response_model=ManifestResponse)
async def manifest(vault_id: str = Query(...)):
    conn = await _require_conn(vault_id)
    items = await build_manifest(conn)
    return ManifestResponse(
        vault_id=vault_id,
        items={k: ManifestEntry(**v) for k, v in items.items()},
    )
