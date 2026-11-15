import secrets
from datetime import UTC

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import settings
from ..db import get_db
from ..deps import ensure_participant_active, get_owned_activity, is_banned
from ..models import Activity, Participant, Word, new_id, utcnow
from ..realtime_publisher import publish
from ..schemas import (
    WordBatchCreate,
    WordBatchResult,
    WordCreate,
    WordRead,
)

router = APIRouter(tags=["words"])


async def require_internal_token(
    x_alf_internal_token: str | None = Header(
        default=None,
        alias="X-ALF-Internal-Token",
    ),
) -> None:
    expected = settings.internal_token
    if (
        not expected
        or not x_alf_internal_token
        or not secrets.compare_digest(x_alf_internal_token, expected)
    ):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Jeton interne invalide.",
        )


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
    if activity.status == "closed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cette activité est terminée.")

    if payload.participant_id is not None:
        await ensure_participant_active(db, activity.id, payload.participant_id)

    word = Word(
        activity_id=activity.id,
        participant_id=payload.participant_id,
        text=payload.text.strip(),
    )
    db.add(word)
    await db.commit()
    await db.refresh(word)

    await publish(
        activity.code,
        {
            "type": "word_added",
            "activity_id": activity.id,
            "id": word.id,
            "participant_id": word.participant_id,
            "text": word.text,
            "created_at": word.created_at.isoformat(),
        },
    )
    return WordRead.model_validate(word)


@router.post(
    "/internal/activities/{code}/words/batch",
    response_model=WordBatchResult,
    dependencies=[Depends(require_internal_token)],
)
async def add_words_batch(
    code: str,
    payload: WordBatchCreate,
    db: AsyncSession = Depends(get_db),
) -> WordBatchResult:
    activity = await db.scalar(
        select(Activity).where(Activity.code == code.upper())
    )
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")
    if activity.kind != "wordcloud":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Activité incompatible.")
    if activity.status == "closed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cette activité est terminée.")

    participant_ids = {
        item.participant_id for item in payload.words if item.participant_id
    }
    participant_map: dict[str, Participant] = {}
    if participant_ids:
        participants = await db.scalars(
            select(Participant).where(
                Participant.activity_id == activity.id,
                Participant.id.in_(participant_ids),
            )
        )
        participant_map = {participant.id: participant for participant in participants}

    ids = [item.id for item in payload.words if item.id]
    existing: set[str] = set()
    if ids:
        existing = set((await db.scalars(select(Word.id).where(Word.id.in_(ids)))).all())

    new_words: list[Word] = []
    seen: set[str] = set()
    skipped = 0
    for item in payload.words:
        if item.id and (item.id in existing or item.id in seen):
            skipped += 1
            continue
        if item.id:
            seen.add(item.id)

        text = item.text.strip()
        if not text:
            skipped += 1
            continue

        if item.participant_id is not None:
            participant = participant_map.get(item.participant_id)
            if participant is None or is_banned(participant):
                skipped += 1
                continue

        created_at = item.created_at or utcnow()
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)

        new_words.append(
            Word(
                id=item.id or new_id(),
                activity_id=activity.id,
                participant_id=item.participant_id,
                text=text,
                created_at=created_at,
            )
        )

    if new_words:
        db.add_all(new_words)
        await db.commit()

    return WordBatchResult(inserted=len(new_words), skipped=skipped)


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
