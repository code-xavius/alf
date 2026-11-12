import csv
import io
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user
from ..db import get_db
from ..deps import get_owned_activity
from ..models import Activity, LiveSession, Participant, Question, Response, Word
from ..realtime import manager
from ..schemas import (
    ActivityResults,
    QuestionCreate,
    QuestionRead,
    QuestionResult,
    QuestionUpdate,
    ResponseCreate,
    ResponseResult,
)

router = APIRouter(tags=["questions"])


async def _load_activity(db: AsyncSession, activity_id: str) -> Activity:
    result = await db.execute(
        select(Activity).options(selectinload(Activity.questions)).where(Activity.id == activity_id)
    )
    activity = result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")
    return activity


async def _owned_question(db: AsyncSession, question_id: str, user_id: str) -> Question:
    question = await db.scalar(
        select(Question)
        .join(Activity, Question.activity_id == Activity.id)
        .join(LiveSession, Activity.session_id == LiveSession.id)
        .where(Question.id == question_id, LiveSession.owner_id == user_id)
    )
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question introuvable.")
    return question


@router.post(
    "/activities/{activity_id}/questions",
    response_model=QuestionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_question(
    activity_id: str,
    payload: QuestionCreate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> QuestionRead:
    activity = await get_owned_activity(db, activity_id, user_id)
    if activity.kind not in ("poll", "quiz", "video"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Activité incompatible.")

    position = payload.position
    if position is None:
        current_max = await db.scalar(
            select(func.max(Question.position)).where(Question.activity_id == activity_id)
        )
        position = (current_max if current_max is not None else -1) + 1

    question = Question(
        activity_id=activity_id,
        prompt=payload.prompt.strip(),
        kind=payload.kind,
        options=payload.options,
        correct_index=payload.correct_index,
        time_limit=payload.time_limit,
        video_ts=payload.video_ts,
        position=position,
    )
    db.add(question)
    await db.commit()
    await db.refresh(question)

    code = await db.scalar(select(LiveSession.code).where(LiveSession.id == activity.session_id))
    if code:
        await manager.broadcast(code, {"type": "questions_updated", "activity_id": activity_id})
    return QuestionRead.model_validate(question)


@router.patch("/questions/{question_id}", response_model=QuestionRead)
async def update_question(
    question_id: str,
    payload: QuestionUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> QuestionRead:
    question = await _owned_question(db, question_id, user_id)

    fields = ("prompt", "kind", "options", "correct_index", "time_limit", "video_ts", "position")
    for field in fields:
        value = getattr(payload, field)
        if value is not None:
            setattr(question, field, value)

    await db.commit()
    await db.refresh(question)
    return QuestionRead.model_validate(question)


@router.delete("/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    question_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> None:
    question = await _owned_question(db, question_id, user_id)
    activity_id = question.activity_id
    activity = await db.get(Activity, activity_id)

    await db.delete(question)
    await db.commit()

    if activity is not None:
        code = await db.scalar(
            select(LiveSession.code).where(LiveSession.id == activity.session_id)
        )
        if code:
            await manager.broadcast(code, {"type": "questions_updated", "activity_id": activity_id})


@router.post("/questions/{question_id}/responses", response_model=ResponseResult)
async def submit_response(
    question_id: str,
    payload: ResponseCreate,
    db: AsyncSession = Depends(get_db),
) -> ResponseResult:
    question = await db.get(Question, question_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question introuvable.")

    activity = await db.get(Activity, question.activity_id)
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")

    participant = await db.get(Participant, payload.participant_id)
    if participant is None or participant.session_id != activity.session_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Participant inconnu.")

    options = question.options or []
    if payload.value < 0 or payload.value >= len(options):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Réponse hors des options.")

    existing = await db.scalar(
        select(Response.id).where(
            Response.question_id == question_id,
            Response.participant_id == payload.participant_id,
        )
    )
    if existing is not None:
        return ResponseResult(recorded=False)

    is_correct = None
    if question.kind == "mcq" and question.correct_index is not None:
        is_correct = question.correct_index == payload.value

    response = Response(
        question_id=question_id,
        participant_id=payload.participant_id,
        value=payload.value,
        is_correct=is_correct,
    )
    db.add(response)
    await db.commit()

    code = await db.scalar(select(LiveSession.code).where(LiveSession.id == activity.session_id))
    if code:
        await manager.broadcast(
            code,
            {
                "type": "response_added",
                "activity_id": activity.id,
                "question_id": question_id,
            },
        )

    return ResponseResult(recorded=True, is_correct=is_correct)


@router.get("/activities/{activity_id}/results", response_model=ActivityResults)
async def activity_results(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ActivityResults:
    activity = await get_owned_activity(db, activity_id, user_id)
    activity = await _load_activity(db, activity_id)

    question_results: list[QuestionResult] = []
    for question in activity.questions:
        rows = await db.execute(
            select(Response.value, func.count(Response.id))
            .where(Response.question_id == question.id)
            .group_by(Response.value)
        )
        counts = [0] * len(question.options or [])
        for value, count in rows:
            if 0 <= value < len(counts):
                counts[value] = count
        question_results.append(
            QuestionResult(
                id=question.id,
                prompt=question.prompt,
                kind=question.kind,
                options=question.options or [],
                correct_index=question.correct_index,
                counts=counts,
                total=sum(counts),
            )
        )

    words: list[dict] = []
    if activity.kind == "wordcloud":
        counter: Counter[str] = Counter()
        text_rows = await db.scalars(select(Word.text).where(Word.activity_id == activity_id))
        for text in text_rows:
            counter[text] += 1
        words = [{"text": text, "count": count} for text, count in counter.most_common(200)]

    return ActivityResults(
        activity_id=activity.id,
        kind=activity.kind,
        questions=question_results,
        words=words,
    )


@router.get("/activities/{activity_id}/export.csv")
async def export_results(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> StreamingResponse:
    activity = await get_owned_activity(db, activity_id, user_id)
    activity = await _load_activity(db, activity_id)

    buffer = io.StringIO()
    writer = csv.writer(buffer)

    if activity.kind == "wordcloud":
        writer.writerow(["mot", "occurrences"])
        counter: Counter[str] = Counter()
        text_rows = await db.scalars(select(Word.text).where(Word.activity_id == activity_id))
        for text in text_rows:
            counter[text] += 1
        for text, count in counter.most_common():
            writer.writerow([text, count])
    else:
        writer.writerow(["question", "option", "reponses", "bonne_reponse"])
        for question in activity.questions:
            rows = await db.execute(
                select(Response.value, func.count(Response.id))
                .where(Response.question_id == question.id)
                .group_by(Response.value)
            )
            counts: dict[int, int] = {value: count for value, count in rows}
            for index, option in enumerate(question.options or []):
                writer.writerow(
                    [
                        question.prompt,
                        option,
                        counts.get(index, 0),
                        "oui" if question.correct_index == index else "",
                    ]
                )

    buffer.seek(0)
    filename = f"alf-{activity.kind}-{activity_id[:8]}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
