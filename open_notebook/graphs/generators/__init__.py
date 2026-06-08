"""Shared infrastructure for the Workshop generators (Phase 2).

Each generator (data table, mind map, flashcards, quiz, infographic, report)
runs a grounded prompt over the notebook's selected sources, validates the
model output against a Pydantic schema (with one repair pass), and persists the
result as a typed Note (``artifact_type`` + ``payload``) so the frontend can
re-render it later without regenerating.

This mirrors ``open_notebook/graphs/transformation.py`` (prompt over content via
``provision_langchain_model``) but adds strict-JSON validation and the
auto-save-as-Note step that the generators need.
"""

import re
from typing import Any, Dict, List, Optional, Type, TypeVar

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from loguru import logger
from pydantic import BaseModel, ValidationError

from open_notebook.ai.provision import provision_langchain_model
from open_notebook.domain.notebook import Note, Source
from open_notebook.exceptions import InvalidInputError, OpenNotebookError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.error_classifier import classify_error
from open_notebook.utils.text_utils import extract_text_content

# Pasted into every generator prompt where it says "[INSERT SHARED GROUNDING
# RULES]". Kept verbatim from notes/notebook-generator-prompts.md.
SHARED_GROUNDING_RULES = """GROUNDING RULES — these override everything else, including the steering prompt:
- The provided sources are your ENTIRE universe of knowledge. Use only what they contain. Do not use outside or world knowledge, and do not infer facts that are not stated.
- Preserve names, numbers, dates, and quotations exactly as they appear in the sources.
- Never fabricate. If requested information is not in the sources, use the failure behavior defined below instead of inventing a plausible answer.
- Write all human-readable text in {{LANGUAGE}}.
- A steering prompt may refine focus, tone, or selection — it may NOT introduce facts that are absent from the sources.
- OUTPUT CONTRACT: return only the specified output. No markdown code fences, no preamble, no explanation, no trailing text. Your entire response must be the artifact and nothing else."""

T = TypeVar("T", bound=BaseModel)


def render_prompt(template: str, variables: Dict[str, str]) -> str:
    """Resolve ``[INSERT SHARED GROUNDING RULES]`` and ``{{VAR}}`` placeholders.

    Uses plain string replacement (not Jinja) on purpose: the generator prompts
    embed literal JSON examples with ``{`` / ``}`` that a templating engine would
    try to parse.
    """
    out = template.replace("[INSERT SHARED GROUNDING RULES]", SHARED_GROUNDING_RULES)
    for key, value in variables.items():
        out = out.replace("{{" + key + "}}", value if value is not None else "")
    return out


async def load_sources(source_ids: List[str]) -> List[Source]:
    """Fetch the selected sources, skipping any that no longer exist."""
    sources: List[Source] = []
    for sid in source_ids:
        try:
            src = await Source.get(sid)
        except Exception as e:
            logger.warning(f"Skipping source {sid}: {e}")
            continue
        if src:
            sources.append(src)
    if not sources:
        raise InvalidInputError("No valid sources selected for generation")
    return sources


def pack_sources(sources: List[Source]) -> str:
    """Concatenate sources into delimited blocks so citations can resolve."""
    blocks = []
    for s in sources:
        title = (s.title or "Untitled").replace('"', "'")
        blocks.append(
            f'<source id="{s.id}" title="{title}">\n{s.full_text or ""}\n</source>'
        )
    return "\n\n".join(blocks)


def _strip_fences(text: str) -> str:
    """Remove accidental ```json fences / leading-trailing prose around JSON."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s*```$", "", t)
    return t.strip()


async def generate_structured(
    *,
    system_prompt: str,
    source_content: str,
    schema: Type[T],
    model_id: Optional[str] = None,
    max_tokens: int = 8192,
) -> T:
    """Run the prompt and validate the JSON output against ``schema``.

    Performs exactly one repair pass on a ``ValidationError`` before failing,
    re-sending the validation error so the model can correct its own output.
    """
    base: List[BaseMessage] = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=source_content),
    ]
    try:
        chain = await provision_langchain_model(
            str(base), model_id, "transformation", max_tokens=max_tokens
        )

        response = await chain.ainvoke(base)
        cleaned = _strip_fences(
            clean_thinking_content(extract_text_content(response.content))
        )
        try:
            return schema.model_validate_json(cleaned)
        except ValidationError as first_error:
            logger.warning(
                f"{schema.__name__} failed validation, attempting one repair: {first_error}"
            )
            repair: List[BaseMessage] = base + [
                HumanMessage(
                    content=(
                        f"Your previous output failed validation: {first_error}. "
                        "Return corrected JSON only, no commentary.\n\n"
                        f"Previous output:\n{cleaned}"
                    )
                )
            ]
            response2 = await chain.ainvoke(repair)
            cleaned2 = _strip_fences(
                clean_thinking_content(extract_text_content(response2.content))
            )
            return schema.model_validate_json(cleaned2)
    except OpenNotebookError:
        raise
    except ValidationError:
        # Repair also failed — surface as a clean error to the caller.
        raise
    except Exception as e:
        error_class, user_message = classify_error(e)
        raise error_class(user_message) from e


async def generate_text(
    *,
    system_prompt: str,
    source_content: str,
    model_id: Optional[str] = None,
    max_tokens: int = 8192,
) -> str:
    """Run a prompt over the sources and return cleaned text (no JSON validation).

    Used by markdown generators (e.g. Reports). Does NOT strip code fences,
    because markdown output may legitimately contain them.
    """
    base: List[BaseMessage] = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=source_content),
    ]
    try:
        chain = await provision_langchain_model(
            str(base), model_id, "transformation", max_tokens=max_tokens
        )
        response = await chain.ainvoke(base)
        return clean_thinking_content(extract_text_content(response.content)).strip()
    except OpenNotebookError:
        raise
    except Exception as e:
        error_class, user_message = classify_error(e)
        raise error_class(user_message) from e


async def save_artifact_note(
    *,
    notebook_id: str,
    artifact_type: str,
    title: str,
    payload: Dict[str, Any],
    content: str,
) -> Note:
    """Persist a generated artifact as a typed Note attached to the notebook.

    This is the auto-save payoff: every generation becomes a first-class,
    reusable Note with no separate "save" step.
    """
    note = Note(
        title=title,
        content=content,
        note_type="ai",
        artifact_type=artifact_type,
        payload=payload,
    )
    await note.save()
    await note.add_to_notebook(notebook_id)
    return note
