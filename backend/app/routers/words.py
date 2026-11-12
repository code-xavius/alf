from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..db import get_db
from ..deps import get_owned_activity
from ..models import Activity, LiveSession, Participant, Word
from ..realtime import manager
from ..schemas import WordCreate, WordRead

router = APIRouter(tags=["words"])


async def _activity_or_404(db: AsyncSession, activity_id: str) -> Activity:
    activity = await db.get(Activity, activity_id)
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")
    return activity


@router.post(
    "/activities/{activity_id}/words",
    response_model=WordRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_word(
    activity_id: str,
    payload: WordCreate,
    db: AsyncSession = Depends(get_db),
) -> WordRead:
    activity = await _activity_or_404(db, activity_id)
    if activity.kind != "wordcloud":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Activité incompatible.")

    if payload.participant_id is not None:
        participant = await db.get(Participant, payload.participant_id)
        if participant is None or participant.session_id != activity.session_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Participant inconnu.")

    word = Word(
        activity_id=activity.id,
        participant_id=payload.participant_id,
        text=payload.text.strip(),
    )
    db.add(word)
    await db.commit()
    await db.refresh(word)

    code = await db.scalar(select(LiveSession.code).where(LiveSession.id == activity.session_id))
    if code:
        await manager.broadcast(
            code,
            {
                "type": "word_added",
                "activity_id": activity.id,
                "text": word.text,
                "created_at": word.created_at.isoformat(),
            },
        )
    return WordRead.model_validate(word)


@router.get("/activities/{activity_id}/words/public", response_model=list[WordRead])
async def list_public_words(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[WordRead]:
    activity = await _activity_or_404(db, activity_id)
    if activity.kind != "wordcloud":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Activité incompatible.")
    words = await db.scalars(
        select(Word).where(Word.activity_id == activity_id).order_by(Word.created_at)
    )
    return [WordRead.model_validate(word) for word in words]


@router.get("/activities/{activity_id}/words", response_model=list[WordRead])
async def list_words(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> list[WordRead]:
    await get_owned_activity(db, activity_id, user_id)
    words = await db.scalars(
        select(Word).where(Word.activity_id == activity_id).order_by(Word.created_at)
    )
    return [WordRead.model_validate(word) for word in words]
