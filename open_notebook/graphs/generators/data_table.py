"""Data Table generator — extracts source text into an auditable table.

Output is a strict JSON object (columns / rows / citations) persisted as the
Note ``payload``; a markdown rendering is stored as ``content`` for search and
embeddings. Prompt is kept verbatim from notes/notebook-generator-prompts.md.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from open_notebook.domain.notebook import Note, Notebook
from open_notebook.graphs.generators import (
    generate_structured,
    load_sources,
    pack_sources,
    render_prompt,
    save_artifact_note,
)

ARTIFACT_TYPE = "data_table"

DATA_TABLE_PROMPT = """You are a research analyst extracting unstructured source text into a clean, auditable table.

[INSERT SHARED GROUNDING RULES]

TASK
Build a table from the sources according to {{STEERING_PROMPT}}.
- If the steering prompt names the columns/entities, use EXACTLY those columns.
- If it does not, infer a sensible comparison schema from the sources and "{{NOTEBOOK_TITLE}}".

CELL RULES
- "columns": ordered array of column names.
- "rows": each object MUST contain every column key. A value that is not stated in the sources is exactly the string "N/A". Never guess, estimate, or infer a missing value.
- Keep values atomic and faithful to the wording in the sources. No duplicate rows.

CITATIONS (the audit trail — get this right)
For every cell that asserts a non-trivial fact (i.e. not "N/A"), add one citation:
- "row": 0-based index matching the rows array order.
- "column": the exact column name.
- "quote": a SHORT, copy-EXACT substring from a source that supports the cell. Must appear verbatim in the sources. Do not paraphrase inside a quote.
- "source": the title or id of the source the quote came from.

FAILURE BEHAVIOR
If nothing relevant is found, return rows: [] and citations: [] (keep "columns" if the user specified them, otherwise []). This triggers the "Data not found" state — do not fabricate rows.

OUTPUT
Return only the JSON object, matching this schema exactly:
{"columns": ["..."], "rows": [{"<col>": "<value-or-N/A>"}], "citations": [{"row": 0, "column": "...", "quote": "...", "source": "..."}]}"""


class DataTableCitation(BaseModel):
    row: int
    column: str
    quote: str
    source: str


class DataTablePayload(BaseModel):
    columns: List[str] = Field(default_factory=list)
    rows: List[Dict[str, Any]] = Field(default_factory=list)
    citations: List[DataTableCitation] = Field(default_factory=list)


def _to_markdown(table: DataTablePayload) -> str:
    """Plain-markdown rendering for the Note content (search/embeddings/export)."""
    if not table.columns or not table.rows:
        return "Data not found in the selected sources."
    header = "| " + " | ".join(table.columns) + " |"
    divider = "| " + " | ".join(["---"] * len(table.columns)) + " |"
    lines = [header, divider]
    for row in table.rows:
        cells = [str(row.get(col, "N/A")).replace("\n", " ") for col in table.columns]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


async def generate_data_table(
    *,
    notebook_id: str,
    source_ids: List[str],
    steering_prompt: str = "",
    language: str = "en-US",
    model_id: Optional[str] = None,
) -> Note:
    notebook = await Notebook.get(notebook_id)
    notebook_title = notebook.name if notebook else ""

    sources = await load_sources(source_ids)
    source_content = pack_sources(sources)

    system_prompt = render_prompt(
        DATA_TABLE_PROMPT,
        {
            "STEERING_PROMPT": steering_prompt
            or "(none provided — infer a sensible comparison schema from the sources)",
            "NOTEBOOK_TITLE": notebook_title,
            "LANGUAGE": language or "en-US",
        },
    )

    table = await generate_structured(
        system_prompt=system_prompt,
        source_content=source_content,
        schema=DataTablePayload,
        model_id=model_id,
    )

    payload = table.model_dump()
    # Lineage for "View prompt" / "Regenerate" without re-deriving inputs.
    payload["_generation"] = {
        "feature": ARTIFACT_TYPE,
        "source_ids": [str(s.id) for s in sources],
        "steering_prompt": steering_prompt,
        "language": language,
    }

    title = f"Data Table — {notebook_title}" if notebook_title else "Data Table"
    return await save_artifact_note(
        notebook_id=notebook_id,
        artifact_type=ARTIFACT_TYPE,
        title=title,
        payload=payload,
        content=_to_markdown(table),
    )
