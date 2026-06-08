"""Async Workshop generator command.

Runs the (slow) LLM generation in the background worker so the HTTP request
returns immediately — no proxy/client timeout regardless of model speed or how
many generations are queued. Dispatches to the per-feature generate_* functions.
"""

import time
from typing import List, Optional

from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.exceptions import InvalidInputError
from open_notebook.graphs.generators.data_table import generate_data_table
from open_notebook.graphs.generators.flashcards import generate_flashcards
from open_notebook.graphs.generators.infographic import generate_infographic
from open_notebook.graphs.generators.mindmap import generate_mindmap
from open_notebook.graphs.generators.quiz import generate_quiz
from open_notebook.graphs.generators.report import generate_report


class GenerateArtifactInput(CommandInput):
    notebook_id: str
    feature: str
    source_ids: List[str] = []
    steering_prompt: str = ""
    language: str = "en-US"
    model_id: Optional[str] = None
    # feature-specific options (ignored by features that don't use them)
    template: str = "Briefing Document"
    length: str = "standard"
    difficulty: str = "medium"
    quantity: str = "standard"
    card_count: Optional[int] = None
    question_count: Optional[int] = None
    orientation: str = "Landscape"
    detail: str = "Standard"
    style: str = "Professional"


class GenerateArtifactOutput(CommandOutput):
    success: bool
    note_id: Optional[str] = None
    artifact_type: Optional[str] = None
    processing_time: float = 0.0
    error_message: Optional[str] = None


@command("generate_artifact", app="open_notebook", retry=None)
async def generate_artifact_command(
    input_data: GenerateArtifactInput,
) -> GenerateArtifactOutput:
    start = time.time()
    feature = input_data.feature
    common = dict(
        notebook_id=input_data.notebook_id,
        source_ids=input_data.source_ids,
        steering_prompt=input_data.steering_prompt,
        language=input_data.language,
        model_id=input_data.model_id,
    )
    try:
        if not input_data.source_ids:
            raise InvalidInputError("At least one source must be selected")

        if feature == "data_table":
            note = await generate_data_table(**common)
        elif feature == "report":
            note = await generate_report(
                template=input_data.template, length=input_data.length, **common
            )
        elif feature == "flashcards":
            note = await generate_flashcards(
                difficulty=input_data.difficulty,
                quantity=input_data.quantity,
                card_count=input_data.card_count,
                **common,
            )
        elif feature == "quiz":
            note = await generate_quiz(
                difficulty=input_data.difficulty,
                quantity=input_data.quantity,
                question_count=input_data.question_count,
                **common,
            )
        elif feature == "infographic":
            note = await generate_infographic(
                orientation=input_data.orientation,
                detail=input_data.detail,
                style=input_data.style,
                **common,
            )
        elif feature == "mindmap":
            note = await generate_mindmap(**common)
        else:
            raise InvalidInputError(f"Unknown generator feature: {feature}")

        logger.info(
            f"generate_artifact[{feature}] -> {note.id} in {time.time() - start:.1f}s"
        )
        return GenerateArtifactOutput(
            success=True,
            note_id=str(note.id) if note.id else None,
            artifact_type=note.artifact_type,
            processing_time=time.time() - start,
        )
    except Exception as e:
        logger.error(f"generate_artifact[{feature}] failed: {e}")
        logger.exception(e)
        return GenerateArtifactOutput(
            success=False,
            processing_time=time.time() - start,
            error_message=str(e),
        )
