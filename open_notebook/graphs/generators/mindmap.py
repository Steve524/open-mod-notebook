"""Mind Map generator — a hierarchical concept tree grounded in the sources.

Model outputs a single recursive JSON object (id/label/children) persisted as
the Note ``payload`` for the React Flow viewer to re-render. Prompt verbatim
from notes/notebook-generator-prompts.md.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

from open_notebook.domain.notebook import Note, Notebook
from open_notebook.graphs.generators import (
    generate_structured,
    load_sources,
    pack_sources,
    render_prompt,
    save_artifact_note,
)

ARTIFACT_TYPE = "mindmap"

MINDMAP_PROMPT = """You are a knowledge architect. Build a hierarchical mind map of the source material so a reader can grasp its macro-structure at a glance.

[INSERT SHARED GROUNDING RULES]

TASK
Read the sources and construct a concept tree:
- Exactly one root node. Its label is the overarching theme actually supported by the sources (use "{{NOTEBOOK_TITLE}}" only if the sources genuinely support it as the central theme).
- 3 to 6 primary branches under the root.
- Each branch may carry secondary and tertiary children. Maximum depth 4 levels including root.
- Every node label must be a concept, entity, theme, or relationship that is EXPLICITLY present in the sources. No invented connective nodes.

NODE RULES
- "id": unique across the entire tree. Root is "root"; use short slugs for the rest (e.g. "n1", "n1a", "n1a1"). No two nodes share an id.
- "label": concise, ideally <= 5 words (hard max 7), Title Case, no trailing punctuation.
- "children": always present. Use [] for leaf nodes.
- No duplicate sibling labels. Aim for a balanced tree, not one giant branch.

STEERING
If {{STEERING_PROMPT}} is non-empty, let it bias which themes are emphasized or pruned - but every node must still come from the sources.

FAILURE BEHAVIOR
If the sources do not support a clear hierarchy, still return a valid root whose children are the distinct themes you can find, each with "children": []. Never return an empty tree.

OUTPUT
Return only the JSON object for the root node, matching this schema exactly:
{"id": "root", "label": "<topic>", "children": [{"id": "n1", "label": "...", "children": []}]}"""


class MindMapNode(BaseModel):
    id: str
    label: str
    children: List["MindMapNode"] = Field(default_factory=list)


MindMapNode.model_rebuild()


def _to_markdown(node: MindMapNode, depth: int = 0) -> str:
    line = f"{'  ' * depth}- {node.label}"
    parts = [line]
    for child in node.children:
        parts.append(_to_markdown(child, depth + 1))
    return "\n".join(parts)


async def generate_mindmap(
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
        MINDMAP_PROMPT,
        {
            "STEERING_PROMPT": steering_prompt or "(none provided)",
            "NOTEBOOK_TITLE": notebook_title,
            "LANGUAGE": language or "en-US",
        },
    )

    root = await generate_structured(
        system_prompt=system_prompt,
        source_content=source_content,
        schema=MindMapNode,
        model_id=model_id,
    )

    payload = root.model_dump()
    payload["_generation"] = {
        "feature": ARTIFACT_TYPE,
        "source_ids": [str(s.id) for s in sources],
        "steering_prompt": steering_prompt,
        "language": language,
        "options": {},
    }
    title = f"Mind Map — {notebook_title}" if notebook_title else "Mind Map"
    return await save_artifact_note(
        notebook_id=notebook_id,
        artifact_type=ARTIFACT_TYPE,
        title=title,
        payload=payload,
        content=_to_markdown(root),
    )
