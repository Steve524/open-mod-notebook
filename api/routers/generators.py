"""Workshop generator endpoints (Phase 2).

Generation is slow on local models, so each endpoint submits an async
`generate_artifact` job and returns a job_id immediately. The worker runs the
generation in the background and saves the resulting Note; the frontend polls
`/commands/jobs/{job_id}` and refreshes the notes list when done. This avoids
proxy/client timeouts entirely.
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field

from api.command_service import CommandService

# Import so the command registers in the API process registry (submit validates
# against it). The worker registers it via `--import-modules commands`.
import commands.generator_commands  # noqa: F401,E402

router = APIRouter()


class BaseGenerateRequest(BaseModel):
    source_ids: List[str] = Field(default_factory=list)
    steering_prompt: Optional[str] = ""
    language: Optional[str] = "en-US"
    model_id: Optional[str] = None


class ReportRequest(BaseGenerateRequest):
    template: str = "Briefing Document"
    length: str = "standard"


class FlashcardsRequest(BaseGenerateRequest):
    difficulty: str = "medium"
    quantity: str = "standard"
    card_count: Optional[int] = None


class QuizRequest(BaseGenerateRequest):
    difficulty: str = "medium"
    quantity: str = "standard"
    question_count: Optional[int] = None


class InfographicRequest(BaseGenerateRequest):
    orientation: str = "Landscape"
    detail: str = "Standard"
    style: str = "Professional"


class GenerateJobResponse(BaseModel):
    job_id: str
    status: str


async def _submit(
    notebook_id: str, feature: str, body: BaseGenerateRequest, extra: dict
) -> GenerateJobResponse:
    if not body.source_ids:
        raise HTTPException(
            status_code=400, detail="At least one source must be selected"
        )
    args = {
        "notebook_id": notebook_id,
        "feature": feature,
        "source_ids": body.source_ids,
        "steering_prompt": body.steering_prompt or "",
        "language": body.language or "en-US",
        "model_id": body.model_id,
        **extra,
    }
    try:
        job_id = await CommandService.submit_command_job(
            "open_notebook", "generate_artifact", args
        )
        return GenerateJobResponse(job_id=job_id, status="submitted")
    except Exception as e:
        logger.error(f"Failed to submit {feature} generation: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to submit {feature} generation: {str(e)}"
        )


@router.post("/notebooks/{notebook_id}/generate/data_table", response_model=GenerateJobResponse)
async def generate_data_table_endpoint(notebook_id: str, body: BaseGenerateRequest):
    return await _submit(notebook_id, "data_table", body, {})


@router.post("/notebooks/{notebook_id}/generate/mindmap", response_model=GenerateJobResponse)
async def generate_mindmap_endpoint(notebook_id: str, body: BaseGenerateRequest):
    return await _submit(notebook_id, "mindmap", body, {})


@router.post("/notebooks/{notebook_id}/generate/report", response_model=GenerateJobResponse)
async def generate_report_endpoint(notebook_id: str, body: ReportRequest):
    return await _submit(
        notebook_id, "report", body, {"template": body.template, "length": body.length}
    )


@router.post("/notebooks/{notebook_id}/generate/flashcards", response_model=GenerateJobResponse)
async def generate_flashcards_endpoint(notebook_id: str, body: FlashcardsRequest):
    return await _submit(
        notebook_id,
        "flashcards",
        body,
        {
            "difficulty": body.difficulty,
            "quantity": body.quantity,
            "card_count": body.card_count,
        },
    )


@router.post("/notebooks/{notebook_id}/generate/quiz", response_model=GenerateJobResponse)
async def generate_quiz_endpoint(notebook_id: str, body: QuizRequest):
    return await _submit(
        notebook_id,
        "quiz",
        body,
        {
            "difficulty": body.difficulty,
            "quantity": body.quantity,
            "question_count": body.question_count,
        },
    )


@router.post("/notebooks/{notebook_id}/generate/infographic", response_model=GenerateJobResponse)
async def generate_infographic_endpoint(notebook_id: str, body: InfographicRequest):
    return await _submit(
        notebook_id,
        "infographic",
        body,
        {
            "orientation": body.orientation,
            "detail": body.detail,
            "style": body.style,
        },
    )
