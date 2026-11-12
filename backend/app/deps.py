from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .models import Activity, LiveSession


async def get_owned_session(db: AsyncSession, session_id: str, user_id: str) -> LiveSession:
    session = await db.scalar(
        select(LiveSession).where(
            LiveSession.id == session_id,
            LiveSession.owner_id == user_id,
        )
    )
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session introuvable.")
    return session


async def get_owned_activity(db: AsyncSession, activity_id: str, user_id: str) -> Activity:
    activity = await db.scalar(
        select(Activity)
        .join(LiveSession, Activity.session_id == LiveSession.id)
        .where(Activity.id == activity_id, LiveSession.owner_id == user_id)
    )
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")
    return activity


async def load_session_detail(db: AsyncSession, session_id: str) -> LiveSession | None:
    result = await db.execute(
        select(LiveSession)
        .options(selectinload(LiveSession.activities).selectinload(Activity.questions))
        .where(LiveSession.id == session_id)
    )
    return result.scalar_one_or_none()


async def load_session_by_code(db: AsyncSession, code: str) -> LiveSession | None:
    result = await db.execute(
        select(LiveSession)
        .options(selectinload(LiveSession.activities).selectinload(Activity.questions))
        .where(LiveSession.code == code.upper())
    )
    return result.scalar_one_or_none()
