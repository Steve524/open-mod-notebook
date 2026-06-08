"""Infographic generator — a structured layout payload rendered as HTML/SVG.

No diffusion dependency: the LLM emits a layout object the frontend renders.
Prompt verbatim from notes/notebook-generator-prompts.md.
"""

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

ARTIFACT_TYPE = "infographic"

INFOGRAPHIC_PROMPT = """You are an information designer turning the sources into a single, scannable infographic layout.

[INSERT SHARED GROUNDING RULES]

TASK
From the sources, produce a structured layout the frontend will render as HTML/SVG. Echo the chosen options: "orientation" = lowercased {{ORIENTATION}}, "style" = lowercased {{STYLE}}.

DETAIL LEVEL ({{DETAIL}})
- Concise: 3 sections, 2-3 key_stats.
- Standard: 4-5 sections, 3-4 key_stats.
- Detailed: 6-8 sections, 4-6 key_stats.

CONTENT RULES
- "title"/"subtitle": faithful to the central theme (default title "{{NOTEBOOK_TITLE}}").
- "sections": each a distinct grounded idea. "body" is infographic-short (one or two lines).
- "icon_hint": a GENERIC icon keyword (e.g. "trending-up", "shield", "clock"). Never a brand, logo, or copyrighted character.
- "key_stats": numbers must be EXACT figures taken from the sources. THIS IS THE HIGHEST-RISK FIELD: do not invent, round, or estimate statistics. If the sources contain no real figures, return "key_stats": [].
- "callout"/"accent_hint": use "N/A" when not applicable. Set "accent_hint" only if the steering prompt requests a color/theme.

STEERING
If {{STEERING_PROMPT}} is non-empty, apply its focus, audience, or theme within the sources.

FAILURE BEHAVIOR
If there is no quantifiable data but there is thematic structure, return sections with an empty "key_stats". Only if the sources contain essentially nothing usable, set "error" to "Information not found in sources" with empty sections and key_stats.

OUTPUT
Return only the JSON object, matching this schema exactly:
{"title": "...", "subtitle": "...", "orientation": "square|portrait|landscape", "style": "professional|sketch|kawaii", "accent_hint": "<palette or N/A>", "sections": [{"heading": "...", "body": "...", "icon_hint": "...", "callout": "<one-line or N/A>"}], "key_stats": [{"value": "42%", "label": "...", "icon_hint": "percent", "source": "<source title or id>"}], "footer": "<optional>"}"""


class InfographicSection(BaseModel):
    heading: str
    body: str = ""
    icon_hint: str = ""
    callout: str = "N/A"


class InfographicStat(BaseModel):
    value: str
    label: str = ""
    icon_hint: str = ""
    source: str = ""


class InfographicPayload(BaseModel):
    title: str
    subtitle: str = ""
    orientation: str = "landscape"
    style: str = "professional"
    accent_hint: str = "N/A"
    sections: List[InfographicSection] = Field(default_factory=list)
    key_stats: List[InfographicStat] = Field(default_factory=list)
    footer: str = ""
    error: Optional[str] = None


def _to_markdown(info: InfographicPayload) -> str:
    if info.error:
        return info.error
    lines = [f"# {info.title}"]
    if info.subtitle:
        lines.append(f"_{info.subtitle}_")
    for s in info.sections:
        lines.append(f"\n## {s.heading}\n{s.body}")
    if info.key_stats:
        lines.append("\n## Key Stats")
        for st in info.key_stats:
            lines.append(f"- **{st.value}** — {st.label}")
    return "\n".join(lines).strip()


async def generate_infographic(
    *,
    notebook_id: str,
    source_ids: List[str],
    orientation: str = "Landscape",
    detail: str = "Standard",
    style: str = "Professional",
    steering_prompt: str = "",
    language: str = "en-US",
    model_id: Optional[str] = None,
) -> Note:
    notebook = await Notebook.get(notebook_id)
    notebook_title = notebook.name if notebook else ""

    sources = await load_sources(source_ids)
    source_content = pack_sources(sources)

    system_prompt = render_prompt(
        INFOGRAPHIC_PROMPT,
        {
            "ORIENTATION": orientation,
            "DETAIL": detail,
            "STYLE": style,
            "STEERING_PROMPT": steering_prompt or "(none provided)",
            "NOTEBOOK_TITLE": notebook_title,
            "LANGUAGE": language or "en-US",
        },
    )

    info = await generate_structured(
        system_prompt=system_prompt,
        source_content=source_content,
        schema=InfographicPayload,
        model_id=model_id,
    )

    payload = info.model_dump()
    payload["_generation"] = {
        "feature": ARTIFACT_TYPE,
        "source_ids": [str(s.id) for s in sources],
        "steering_prompt": steering_prompt,
        "language": language,
    }
    title = f"Infographic — {notebook_title}" if notebook_title else "Infographic"
    return await save_artifact_note(
        notebook_id=notebook_id,
        artifact_type=ARTIFACT_TYPE,
        title=title,
        payload=payload,
        content=_to_markdown(info),
    )
