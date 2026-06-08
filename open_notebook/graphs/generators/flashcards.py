"""Flashcards generator — a deck of front/back/hint cards for active recall.

Model outputs a bare JSON array; we validate it as a RootModel and store it
under ``payload.cards`` (payload is an object column, not an array). Prompt
verbatim from notes/notebook-generator-prompts.md.
"""

from typing import List, Optional

from pydantic import BaseModel, RootModel

from open_notebook.domain.notebook import Note, Notebook
from open_notebook.graphs.generators import (
    generate_structured,
    load_sources,
    pack_sources,
    render_prompt,
    save_artifact_note,
)

ARTIFACT_TYPE = "flashcards"

FLASHCARDS_PROMPT = """You are a learning scientist designing flashcards for active recall.

[INSERT SHARED GROUNDING RULES]

TASK
From the sources, produce study cards targeting key terminology, definitions, dates, formulas, distinctions, and cause/effect relationships.

COUNT
If {{CARD_COUNT}} is a number, target that number. Otherwise map {{QUANTITY}}:
fewer ~ 8-10, standard ~ 15-18, more ~ 25-30 cards.

DIFFICULTY ({{DIFFICULTY}})
- easy: recall of single terms and definitions.
- medium: relationships and application across concepts.
- hard: synthesis, edge cases, and "why/how" reasoning.

CARD RULES
- "front": a concise prompt, term, or question.
- "back": the answer, faithful to the sources - complete but tight.
- "hint": a nudge toward the answer that does NOT reveal it. Never restate the back.
- Each card must be answerable from the sources alone. No duplicates. Spread coverage across all selected sources rather than over-sampling one.

STEERING
If {{STEERING_PROMPT}} is non-empty, focus the deck accordingly (topic, audience, tone).

FAILURE BEHAVIOR
Prefer grounding over hitting the count. If the sources cannot support the target number, return as many well-grounded cards as the sources genuinely support - do not pad with filler or near-duplicate cards.

OUTPUT
Return only the JSON array, matching this schema exactly:
[{"front": "...", "back": "...", "hint": "..."}]"""


class Flashcard(BaseModel):
    front: str
    back: str
    hint: str = ""


class FlashcardDeck(RootModel[List[Flashcard]]):
    pass


def _to_markdown(cards: List[dict]) -> str:
    if not cards:
        return "No flashcards could be grounded in the selected sources."
    lines = []
    for i, c in enumerate(cards, 1):
        lines.append(f"**{i}. {c.get('front', '')}**")
        lines.append(f"- Answer: {c.get('back', '')}")
        if c.get("hint"):
            lines.append(f"- Hint: {c.get('hint')}")
        lines.append("")
    return "\n".join(lines).strip()


async def generate_flashcards(
    *,
    notebook_id: str,
    source_ids: List[str],
    difficulty: str = "medium",
    quantity: str = "standard",
    card_count: Optional[int] = None,
    steering_prompt: str = "",
    language: str = "en-US",
    model_id: Optional[str] = None,
) -> Note:
    notebook = await Notebook.get(notebook_id)
    notebook_title = notebook.name if notebook else ""

    sources = await load_sources(source_ids)
    source_content = pack_sources(sources)

    system_prompt = render_prompt(
        FLASHCARDS_PROMPT,
        {
            "DIFFICULTY": difficulty,
            "QUANTITY": quantity,
            "CARD_COUNT": str(card_count) if card_count else "not specified",
            "STEERING_PROMPT": steering_prompt or "(none provided)",
            "LANGUAGE": language or "en-US",
        },
    )

    deck = await generate_structured(
        system_prompt=system_prompt,
        source_content=source_content,
        schema=FlashcardDeck,
        model_id=model_id,
    )
    cards = deck.model_dump()

    payload = {
        "cards": cards,
        "difficulty": difficulty,
        "_generation": {
            "feature": ARTIFACT_TYPE,
            "source_ids": [str(s.id) for s in sources],
            "steering_prompt": steering_prompt,
            "language": language,
        },
    }
    title = f"Flashcards — {notebook_title}" if notebook_title else "Flashcards"
    return await save_artifact_note(
        notebook_id=notebook_id,
        artifact_type=ARTIFACT_TYPE,
        title=title,
        payload=payload,
        content=_to_markdown(cards),
    )
