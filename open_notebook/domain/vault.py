"""Domain models for vault sync (Obsidian / local-folder).

- VaultConnection: a workspace-level folder connection (no notebook link).
- VaultSubscription: a notebook <-> connection edge (unique per pair).
- VaultFileState: one row per ingested file; the key for the 3-way diff.

Record-link fields use the same `Union[str, RecordID]` + validator pattern as
`Source.command` so they persist as proper SurrealDB record links.
"""

from datetime import datetime
from typing import Any, ClassVar, Dict, List, Optional, Union

from pydantic import ConfigDict, Field, field_validator
from surrealdb import RecordID

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel

DEFAULT_INCLUDE_GLOBS = ["**/*.md"]
DEFAULT_EXCLUDE_GLOBS = [
    ".obsidian/**",
    "**/.trash/**",
    "**/*.excalidraw",
    "templates/**",
]


def _to_record(value: Any) -> Any:
    """Coerce a record-id string into a RecordID; pass RecordID/None through."""
    if isinstance(value, str) and value:
        return ensure_record_id(value)
    return value


class VaultConnection(ObjectModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    table_name: ClassVar[str] = "vault_connection"
    nullable_fields: ClassVar[set[str]] = {"last_error", "last_synced_at", "stats"}

    name: str
    root_path: str
    sync_mode: str = "inherit"  # "manual" | "live" | "inherit"
    include_globs: List[str] = Field(default_factory=lambda: list(DEFAULT_INCLUDE_GLOBS))
    exclude_globs: List[str] = Field(default_factory=lambda: list(DEFAULT_EXCLUDE_GLOBS))
    embed: bool = True
    transformations: List[Union[str, RecordID]] = Field(default_factory=list)
    status: str = "idle"  # "idle" | "scanning" | "watching" | "error"
    last_synced_at: Optional[datetime] = None
    last_error: Optional[str] = None
    stats: Optional[Dict[str, Any]] = None

    @field_validator("transformations", mode="before")
    @classmethod
    def _coerce_transformations(cls, v):
        if not v:
            return []
        return [_to_record(x) for x in v]


class VaultSubscription(ObjectModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    table_name: ClassVar[str] = "vault_subscription"

    notebook: Union[str, RecordID]
    connection: Union[str, RecordID]

    @field_validator("notebook", "connection", mode="before")
    @classmethod
    def _coerce_link(cls, v):
        return _to_record(v)

    @classmethod
    async def for_notebook(cls, notebook_id: str) -> List["VaultSubscription"]:
        rows = await repo_query(
            "SELECT * FROM vault_subscription WHERE notebook = $nb",
            {"nb": ensure_record_id(notebook_id)},
        )
        return [cls(**r) for r in rows] if rows else []

    @classmethod
    async def for_connection(cls, connection_id: str) -> List["VaultSubscription"]:
        rows = await repo_query(
            "SELECT * FROM vault_subscription WHERE connection = $c",
            {"c": ensure_record_id(connection_id)},
        )
        return [cls(**r) for r in rows] if rows else []

    @classmethod
    async def find(
        cls, notebook_id: str, connection_id: str
    ) -> Optional["VaultSubscription"]:
        rows = await repo_query(
            "SELECT * FROM vault_subscription WHERE notebook = $nb AND connection = $c LIMIT 1",
            {
                "nb": ensure_record_id(notebook_id),
                "c": ensure_record_id(connection_id),
            },
        )
        return cls(**rows[0]) if rows else None


class VaultFileState(ObjectModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    table_name: ClassVar[str] = "vault_file_state"
    nullable_fields: ClassVar[set[str]] = {"last_seen_at"}

    connection: Union[str, RecordID]
    rel_path: str
    source: Union[str, RecordID]
    content_hash: str
    mtime: float = 0.0
    size: int = 0
    last_seen_at: Optional[datetime] = None

    @field_validator("connection", "source", mode="before")
    @classmethod
    def _coerce_link(cls, v):
        return _to_record(v)

    @classmethod
    async def for_connection(cls, connection_id: str) -> List["VaultFileState"]:
        rows = await repo_query(
            "SELECT * FROM vault_file_state WHERE connection = $c",
            {"c": ensure_record_id(connection_id)},
        )
        return [cls(**r) for r in rows] if rows else []
