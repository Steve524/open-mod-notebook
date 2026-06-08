"""Reports generator — a structured first-draft Markdown document.

Output is Markdown (not JSON): stored as the Note ``content`` (so it is
searchable/embeddable and renders in the existing markdown viewer); the chosen
template/length go in ``payload``. Prompt verbatim from
notes/notebook-generator-prompts.md.
"""

from typing import List, Optional

from open_notebook.domain.notebook import Note, Notebook
from open_notebook.graphs.generators import (
    generate_text,
    load_sources,
    pack_sources,
    render_prompt,
    save_artifact_note,
)

ARTIFACT_TYPE = "report"

REPORT_PROMPT = """You are a research drafting assistant producing a structured first-draft document from the sources.

[INSERT SHARED GROUNDING RULES]
(Override the JSON line of the output contract: for this feature you output MARKDOWN, not JSON.)

TASK
Write a {{REPORT_TEMPLATE}} report from the sources at {{LENGTH}} length, in {{LANGUAGE}}.
Default the document title to "{{NOTEBOOK_TITLE}}" unless the steering prompt specifies otherwise.

TEMPLATE STRUCTURES
- Briefing Document: H1 title, an Executive Summary, thematic sections with H2 headers, a short list of notable verbatim quotes (each <= 15 words, exact), and an Implications / Recommendations section grounded in the sources.
- Study Guide: Overview; Key Concepts & Definitions (a glossary-style list); Themes & Connections; Review Questions (short-answer, with grounded answers); one-paragraph Summary.
- FAQ: a numbered list of question-and-answer pairs, each answer drawn only from the sources.
- Timeline: chronological entries "**<date>** — <event>" in source-supported order. If exact dates are absent, order by the sequence described and mark such entries "(approx.)".
- Custom: follow {{STEERING_PROMPT}} for structure; if it is empty, default to Briefing Document.

FORMATTING
Use Markdown headers, bold, and lists. Integrate short exact quotes only where they add value and keep them verbatim. If a section's information is not in the sources, write "Not covered in the provided sources." rather than padding.

FAILURE BEHAVIOR
If the requested template cannot be satisfied from the sources, produce a Briefing Document instead and add a first line in italics noting the substitution.

OUTPUT
Return only the Markdown document. No code fences, no commentary before or after."""


async def generate_report(
    *,
    notebook_id: str,
    source_ids: List[str],
    template: str = "Briefing Document",
    length: str = "standard",
    steering_prompt: str = "",
    language: str = "en-US",
    model_id: Optional[str] = None,
) -> Note:
    notebook = await Notebook.get(notebook_id)
    notebook_title = notebook.name if notebook else ""

    sources = await load_sources(source_ids)
    source_content = pack_sources(sources)

    system_prompt = render_prompt(
        REPORT_PROMPT,
        {
            "REPORT_TEMPLATE": template,
            "LENGTH": length,
            "STEERING_PROMPT": steering_prompt or "(none provided)",
            "NOTEBOOK_TITLE": notebook_title,
            "LANGUAGE": language or "en-US",
        },
    )

    markdown = await generate_text(
        system_prompt=system_prompt,
        source_content=source_content,
        model_id=model_id,
    )

    payload = {
        "template": template,
        "length": length,
        "_generation": {
            "feature": ARTIFACT_TYPE,
            "source_ids": [str(s.id) for s in sources],
            "steering_prompt": steering_prompt,
            "language": language,
        },
    }
    title = f"{template} — {notebook_title}" if notebook_title else template
    return await save_artifact_note(
        notebook_id=notebook_id,
        artifact_type=ARTIFACT_TYPE,
        title=title,
        payload=payload,
        content=markdown or "No content generated from the selected sources.",
    )
