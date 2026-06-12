"""Wire schemas for the Obsidian plugin adapter (api/routers/obsidian.py).

Mirror the forked plugin's `src/types.ts`, with one deliberate change: every id
is a STRING (Open Notebook uses SurrealDB string record ids like
``notebook:abc``), where SurfSense used integers. All models use
``extra="ignore"`` so the plugin can send additive fields (e.g. richer note
metadata, attachment markers) without breaking the decoder.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class _Lenient(BaseModel):
    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------
class NotePayload(_Lenient):
    vault_id: str
    path: str
    name: str = ""
    extension: str = ""
    content: str = ""
    frontmatter: Dict[str, Any] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)
    headings: List[Dict[str, Any]] = Field(default_factory=list)
    resolved_links: List[str] = Field(default_factory=list)
    unresolved_links: List[str] = Field(default_factory=list)
    embeds: List[str] = Field(default_factory=list)
    aliases: List[str] = Field(default_factory=list)
    content_hash: str = ""
    size: int = 0
    mtime: float = 0
    ctime: float = 0
    # Attachments (omitted from CAPS in v1; rejected per-item in /sync).
    is_binary: bool = False
    binary_base64: Optional[str] = None
    mime_type: Optional[str] = None


# ---------------------------------------------------------------------------
# Health / search spaces / connect
# ---------------------------------------------------------------------------
class HealthResponse(_Lenient):
    capabilities: List[str]
    server_time_utc: str


class SearchSpace(_Lenient):
    id: str
    name: str
    description: Optional[str] = None


class ConnectRequest(_Lenient):
    vault_id: str
    vault_name: str = ""
    search_space_id: str
    vault_fingerprint: str = ""


class ConnectResponse(_Lenient):
    connector_id: str
    vault_id: str
    search_space_id: str
    capabilities: List[str]
    server_time_utc: str


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------
class SyncRequest(_Lenient):
    vault_id: str
    notes: List[NotePayload] = Field(default_factory=list)


class SyncAckItem(_Lenient):
    path: str
    status: str  # "ok" | "queued" | "error"
    document_id: Optional[str] = None
    error: Optional[str] = None


class SyncAck(_Lenient):
    vault_id: str
    indexed: int
    failed: int
    items: List[SyncAckItem]


# ---------------------------------------------------------------------------
# Rename
# ---------------------------------------------------------------------------
class RenamePair(_Lenient):
    old_path: str
    new_path: str


class RenameRequest(_Lenient):
    vault_id: str
    renames: List[RenamePair] = Field(default_factory=list)


class RenameAckItem(_Lenient):
    old_path: str
    new_path: str
    status: str  # "ok" | "error" | "missing"
    document_id: Optional[str] = None
    error: Optional[str] = None


class RenameAck(_Lenient):
    vault_id: str
    renamed: int
    missing: int
    items: List[RenameAckItem]


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------
class DeleteRequest(_Lenient):
    vault_id: str
    paths: List[str] = Field(default_factory=list)


class DeleteAckItem(_Lenient):
    path: str
    status: str  # "ok" | "error" | "missing"
    error: Optional[str] = None


class DeleteAck(_Lenient):
    vault_id: str
    deleted: int
    missing: int
    items: List[DeleteAckItem]


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------
class ManifestEntry(_Lenient):
    hash: str
    mtime: float
    size: int


class ManifestResponse(_Lenient):
    vault_id: str
    items: Dict[str, ManifestEntry]
