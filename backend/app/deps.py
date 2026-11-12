from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .models import Activity, Participant


async def get_owned_activity(db: AsyncSession, activity_id: str, user_id: str) -> Activity:
    activity = await db.scalar(
        select(Activity).where(
            Activity.id == activity_id,
            Activity.owner_id == user_id,
        )
    )
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")
    return activity


async def load_activity_detail(db: AsyncSession, activity_id: str) -> Activity | None:
    result = await db.execute(
        select(Activity)
        .options(selectinload(Activity.questions))
        .where(Activity.id == activity_id)
    )
    return result.scalar_one_or_none()


async def load_activity_by_code(db: AsyncSession, code: str) -> Activity | None:
    result = await db.execute(
        select(Activity)
        .options(selectinload(Activity.questions))
        .where(Activity.code == code.upper())
    )
    return result.scalar_one_or_none()


def is_banned(participant: Participant) -> bool:
    if participant.banned_until is None:
        return False
    until = participant.banned_until
    if until.tzinfo is None:
        until = until.replace(tzinfo=UTC)
    return until > datetime.now(UTC)


async def ensure_participant_active(
    db: AsyncSession, activity_id: str, participant_id: str
) -> Participant:
    participant = await db.get(Participant, participant_id)
    if participant is None or participant.activity_id != activity_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Participant inconnu.")
    if is_banned(participant):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Vous avez été temporairement exclu de cette activité.",
        )
    return participant
