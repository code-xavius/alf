from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user
from ..db import get_db
from ..deps import get_owned_activity, get_owned_session
from ..models import Activity, LiveSession
from ..realtime import manager
from ..schemas import ActivityCreate, ActivityRead, ActivityUpdate

router = APIRouter(tags=["activities"])


async def _load_activity(db: AsyncSession, activity_id: str) -> Activity:
    result = await db.execute(
        select(Activity).options(selectinload(Activity.questions)).where(Activity.id == activity_id)
    )
    activity = result.scalar_one_or_none()
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")
    return activity


async def _session_code(db: AsyncSession, session_id: str) -> str:
    code = await db.scalar(select(LiveSession.code).where(LiveSession.id == session_id))
    if code is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session introuvable.")
    return code


@router.post(
    "/sessions/{session_id}/activities",
    response_model=ActivityRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_activity(
    session_id: str,
    payload: ActivityCreate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ActivityRead:
    await get_owned_session(db, session_id, user_id)

    position = payload.position
    if position is None:
        current_max = await db.scalar(
            select(func.max(Activity.position)).where(Activity.session_id == session_id)
        )
        position = (current_max if current_max is not None else -1) + 1

    state = {"current_question": 0, "revealed": False}
    if payload.kind == "video":
        state["question_open"] = False

    activity = Activity(
        session_id=session_id,
        kind=payload.kind,
        title=payload.title.strip(),
        config=payload.config,
        state=state,
        position=position,
    )
    db.add(activity)
    await db.commit()

    activity = await _load_activity(db, activity.id)
    code = await _session_code(db, session_id)
    await manager.broadcast(
        code,
        {"type": "activity_created", "activity_id": activity.id},
    )
    return ActivityRead.model_validate(activity)


@router.patch("/activities/{activity_id}", response_model=ActivityRead)
async def update_activity(
    activity_id: str,
    payload: ActivityUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ActivityRead:
    activity = await get_owned_activity(db, activity_id, user_id)

    if payload.title is not None:
        activity.title = payload.title.strip()
    if payload.config is not None:
        activity.config = payload.config
    if payload.state is not None:
        activity.state = payload.state
    if payload.position is not None:
        activity.position = payload.position

    await db.commit()
    activity = await _load_activity(db, activity_id)

    code = await _session_code(db, activity.session_id)
    await manager.broadcast(
        code,
        {
            "type": "activity_updated",
            "activity_id": activity.id,
            "title": activity.title,
            "config": activity.config,
            "state": activity.state,
            "position": activity.position,
        },
    )
    return ActivityRead.model_validate(activity)


@router.delete("/activities/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_activity(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> None:
    activity = await get_owned_activity(db, activity_id, user_id)
    session_id = activity.session_id
    code = await _session_code(db, session_id)

    await db.delete(activity)
    await db.commit()

    await manager.broadcast(code, {"type": "activity_deleted", "activity_id": activity_id})
