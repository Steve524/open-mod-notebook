"""Quiz generator — mcq/short questions with answers, explanations, hints.

Model outputs a bare JSON array; validated as a RootModel and stored under
``payload.questions``. Short-answer items use choices=[] and answerIndex=-1.
Prompt verbatim from notes/notebook-generator-prompts.md.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, RootModel

from open_notebook.domain.notebook import Note, Notebook
from open_notebook.graphs.generators import (
    generate_structured,
    load_sources,
    pack_sources,
    render_prompt,
    save_artifact_note,
)

ARTIFACT_TYPE = "quiz"

_QUANTITY_TO_COUNT = {"fewer": 6, "standard": 10, "more": 15}

QUIZ_PROMPT = """You are an assessment designer building a quiz that tests comprehension, not rote recall.

[INSERT SHARED GROUNDING RULES]

TASK
From the sources, write {{QUESTION_COUNT}} questions at {{DIFFICULTY}} difficulty that test understanding, application, and analysis. Every question and answer must be grounded in the sources.

QUESTION TYPES
- "mcq": exactly 4 entries in "choices", exactly one correct. "answerIndex" is the 0-based position of the correct choice. Distractors must be plausible but DEFINITIVELY incorrect per the sources (use common misconceptions or adjacent-but-wrong facts). Vary the correct position across the quiz - do not let it default to index 0. Avoid "all/none of the above" unless meaningful.
- "short": set "choices" to [] and "answerIndex" to -1. Put the canonical answer at the start of "explanation" as "Answer: ...".

EVERY ITEM
- "explanation": grounded justification of the correct answer; for mcq, briefly note why the key distractors are wrong.
- "hint": guidance that helps the learner reason toward the answer WITHOUT revealing it.

STEERING
If {{STEERING_PROMPT}} is non-empty, focus question topics accordingly.

FAILURE BEHAVIOR
If the sources are too thin to support strong distractors, fall back to True/False items rendered as mcq with "choices": ["True", "False"] and the correct "answerIndex".

OUTPUT
Return only the JSON array, matching this schema exactly:
[{"question": "...", "type": "mcq", "choices": ["...", "...", "...", "..."], "answerIndex": 0, "explanation": "...", "hint": "..."}]"""


class QuizQuestion(BaseModel):
    question: str
    type: Literal["mcq", "short"] = "mcq"
    choices: List[str] = Field(default_factory=list)
    answerIndex: int = -1
    explanation: str = ""
    hint: str = ""


class Quiz(RootModel[List[QuizQuestion]]):
    pass


def _to_markdown(questions: List[dict]) -> str:
    if not questions:
        return "No quiz questions could be grounded in the selected sources."
    lines = []
    for i, q in enumerate(questions, 1):
        lines.append(f"**{i}. {q.get('question', '')}**")
        choices = q.get("choices") or []
        for j, ch in enumerate(choices):
            marker = "✓" if j == q.get("answerIndex") else "-"
            lines.append(f"  {marker} {ch}")
        if q.get("explanation"):
            lines.append(f"  Explanation: {q.get('explanation')}")
        lines.append("")
    return "\n".join(lines).strip()


async def generate_quiz(
    *,
    notebook_id: str,
    source_ids: List[str],
    difficulty: str = "medium",
    question_count: Optional[int] = None,
    quantity: str = "standard",
    steering_prompt: str = "",
    language: str = "en-US",
    model_id: Optional[str] = None,
) -> Note:
    notebook = await Notebook.get(notebook_id)
    notebook_title = notebook.name if notebook else ""

    sources = await load_sources(source_ids)
    source_content = pack_sources(sources)

    count = question_count or _QUANTITY_TO_COUNT.get(quantity, 10)
    system_prompt = render_prompt(
        QUIZ_PROMPT,
        {
            "QUESTION_COUNT": str(count),
            "DIFFICULTY": difficulty,
            "STEERING_PROMPT": steering_prompt or "(none provided)",
            "LANGUAGE": language or "en-US",
        },
    )

    quiz = await generate_structured(
        system_prompt=system_prompt,
        source_content=source_content,
        schema=Quiz,
        model_id=model_id,
    )
    questions = quiz.model_dump()

    payload = {
        "questions": questions,
        "difficulty": difficulty,
        "_generation": {
            "feature": ARTIFACT_TYPE,
            "source_ids": [str(s.id) for s in sources],
            "steering_prompt": steering_prompt,
            "language": language,
        },
    }
    title = f"Quiz — {notebook_title}" if notebook_title else "Quiz"
    return await save_artifact_note(
        notebook_id=notebook_id,
        artifact_type=ARTIFACT_TYPE,
        title=title,
        payload=payload,
        content=_to_markdown(questions),
    )
