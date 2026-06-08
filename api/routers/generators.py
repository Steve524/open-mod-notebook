"""Workshop generator endpoints (Phase 2).

Each generator runs a grounded prompt over the notebook's selected sources and
persists the result as a typed Note, which is returned to the caller. The
frontend tiles call these and then invalidate the notes query so the new
artifact card appears on its own.
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field

from api.models import NoteResponse
from open_notebook.domain.notebook import Note
from open_notebook.exceptions import InvalidInputError
from open_notebook.graphs.generators.data_table import generate_data_table
from open_notebook.graphs.generators.flashcards import generate_flashcards
from open_notebook.graphs.generators.infographic import generate_infographic
from open_notebook.graphs.generators.mindmap import generate_mindmap
from open_notebook.graphs.generators.quiz import generate_quiz
from open_notebook.graphs.generators.report import generate_report

router = APIRouter()


class BaseGenerateRequest(BaseModel):
    source_ids: List[str] = Field(
        default_factory=list, description="Selected source IDs to ground generation"
    )
    steering_prompt: Optional[str] = Field(
        "", description="Optional free-text steering for focus/tone/columns"
    )
    language: Optional[str] = Field("en-US", description="Output language")
    model_id: Optional[str] = Field(None, description="Optional explicit model override")


class ReportRequest(BaseGenerateRequest):
    template: str = Field(
        "Briefing Document",
        description="Briefing Document | Study Guide | FAQ | Timeline | Custom",
    )
    length: str = Field("standard", description="short | standard | long")


class FlashcardsRequest(BaseGenerateRequest):
    difficulty: str = Field("medium", description="easy | medium | hard")
    quantity: str = Field("standard", description="fewer | standard | more")
    card_count: Optional[int] = Field(None, description="Explicit card count override")


class QuizRequest(BaseGenerateRequest):
    difficulty: str = Field("medium", description="easy | medium | hard")
    quantity: str = Field("standard", description="fewer | standard | more")
    question_count: Optional[int] = Field(
        None, description="Explicit question count override"
    )


class InfographicRequest(BaseGenerateRequest):
    orientation: str = Field("Landscape", description="Square | Portrait | Landscape")
    detail: str = Field("Standard", description="Concise | Standard | Detailed")
    style: str = Field("Professional", description="Professional | Sketch | Kawaii")


def _note_response(note: Note) -> NoteResponse:
    return NoteResponse(
        id=note.id or "",
        title=note.title,
        content=note.content,
        note_type=note.note_type,
        artifact_type=note.artifact_type,
        payload=note.payload,
        created=str(note.created),
        updated=str(note.updated),
    )


def _require_sources(source_ids: List[str]) -> None:
    if not source_ids:
        raise HTTPException(
            status_code=400, detail="At least one source must be selected"
        )


def _handle_error(feature: str, e: Exception) -> None:
    if isinstance(e, HTTPException):
        raise e
    if isinstance(e, InvalidInputError):
        raise HTTPException(status_code=400, detail=str(e))
    logger.error(f"Error generating {feature}: {str(e)}")
    logger.exception(e)
    raise HTTPException(status_code=500, detail=f"Error generating {feature}: {str(e)}")


@router.post("/notebooks/{notebook_id}/generate/data_table", response_model=NoteResponse)
async def generate_data_table_endpoint(notebook_id: str, body: BaseGenerateRequest):
    """Generate a Data Table from the selected sources and save it as a Note."""
    _require_sources(body.source_ids)
    try:
        note = await generate_data_table(
            notebook_id=notebook_id,
            source_ids=body.source_ids,
            steering_prompt=body.steering_prompt or "",
            language=body.language or "en-US",
            model_id=body.model_id,
        )
        return _note_response(note)
    except Exception as e:
        _handle_error("data_table", e)


@router.post("/notebooks/{notebook_id}/generate/report", response_model=NoteResponse)
async def generate_report_endpoint(notebook_id: str, body: ReportRequest):
    """Generate a Report (markdown) from the selected sources and save it as a Note."""
    _require_sources(body.source_ids)
    try:
        note = await generate_report(
            notebook_id=notebook_id,
            source_ids=body.source_ids,
            template=body.template,
            length=body.length,
            steering_prompt=body.steering_prompt or "",
            language=body.language or "en-US",
            model_id=body.model_id,
        )
        return _note_response(note)
    except Exception as e:
        _handle_error("report", e)


@router.post("/notebooks/{notebook_id}/generate/flashcards", response_model=NoteResponse)
async def generate_flashcards_endpoint(notebook_id: str, body: FlashcardsRequest):
    """Generate a Flashcard deck from the selected sources and save it as a Note."""
    _require_sources(body.source_ids)
    try:
        note = await generate_flashcards(
            notebook_id=notebook_id,
            source_ids=body.source_ids,
            difficulty=body.difficulty,
            quantity=body.quantity,
            card_count=body.card_count,
            steering_prompt=body.steering_prompt or "",
            language=body.language or "en-US",
            model_id=body.model_id,
        )
        return _note_response(note)
    except Exception as e:
        _handle_error("flashcards", e)


@router.post("/notebooks/{notebook_id}/generate/quiz", response_model=NoteResponse)
async def generate_quiz_endpoint(notebook_id: str, body: QuizRequest):
    """Generate a Quiz from the selected sources and save it as a Note."""
    _require_sources(body.source_ids)
    try:
        note = await generate_quiz(
            notebook_id=notebook_id,
            source_ids=body.source_ids,
            difficulty=body.difficulty,
            quantity=body.quantity,
            question_count=body.question_count,
            steering_prompt=body.steering_prompt or "",
            language=body.language or "en-US",
            model_id=body.model_id,
        )
        return _note_response(note)
    except Exception as e:
        _handle_error("quiz", e)


@router.post("/notebooks/{notebook_id}/generate/infographic", response_model=NoteResponse)
async def generate_infographic_endpoint(notebook_id: str, body: InfographicRequest):
    """Generate an Infographic layout from the selected sources and save it as a Note."""
    _require_sources(body.source_ids)
    try:
        note = await generate_infographic(
            notebook_id=notebook_id,
            source_ids=body.source_ids,
            orientation=body.orientation,
            detail=body.detail,
            style=body.style,
            steering_prompt=body.steering_prompt or "",
            language=body.language or "en-US",
            model_id=body.model_id,
        )
        return _note_response(note)
    except Exception as e:
        _handle_error("infographic", e)


@router.post("/notebooks/{notebook_id}/generate/mindmap", response_model=NoteResponse)
async def generate_mindmap_endpoint(notebook_id: str, body: BaseGenerateRequest):
    """Generate a Mind Map from the selected sources and save it as a Note."""
    _require_sources(body.source_ids)
    try:
        note = await generate_mindmap(
            notebook_id=notebook_id,
            source_ids=body.source_ids,
            steering_prompt=body.steering_prompt or "",
            language=body.language or "en-US",
            model_id=body.model_id,
        )
        return _note_response(note)
    except Exception as e:
        _handle_error("mindmap", e)
