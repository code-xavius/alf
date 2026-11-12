import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import settings
from ..db import get_db
from ..deps import get_owned_session, load_session_by_code, load_session_detail
from ..models import LiveSession, Participant
from ..realtime import manager
from ..schemas import (
    JoinRequest,
    ParticipantRead,
    PublicActivity,
    PublicQuestion,
    PublicSession,
    SessionCreate,
    SessionDetail,
    SessionSummary,
    SessionUpdate,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


async def _generate_code(db: AsyncSession) -> str:
    for _ in range(25):
        code = "".join(secrets.choice(ALPHABET) for _ in range(settings.session_code_length))
        exists = await db.scalar(select(LiveSession.id).where(LiveSession.code == code))
        if exists is None:
            return code
    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Code de session indisponible.")


def _public_session(session: LiveSession, participant_count: int = 0) -> PublicSession:
    activities = []
    for activity in session.activities:
        revealed = bool(activity.state.get("revealed"))
        activities.append(
            PublicActivity(
                id=activity.id,
                kind=activity.kind,
                title=activity.title,
                config=activity.config or {},
                state=activity.state or {},
                position=activity.position,
                questions=[
                    PublicQuestion(
                        id=question.id,
                        prompt=question.prompt,
                        kind=question.kind,
                        options=question.options or [],
                        video_ts=question.video_ts,
                        position=question.position,
                        correct_index=question.correct_index if revealed else None,
                    )
                    for question in activity.questions
                ],
            )
        )
    return PublicSession(
        id=session.id,
        code=session.code,
        title=session.title,
        status=session.status,
        current_activity_id=session.current_activity_id,
        participant_count=participant_count,
        activities=activities,
    )


@router.post("", response_model=SessionSummary, status_code=status.HTTP_201_CREATED)
async def create_session(
    payload: SessionCreate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> SessionSummary:
    session = LiveSession(
        code=await _generate_code(db),
        title=payload.title.strip(),
        owner_id=user_id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return SessionSummary.model_validate(session)


@router.get("", response_model=list[SessionSummary])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> list[SessionSummary]:
    result = await db.scalars(
        select(LiveSession)
        .where(LiveSession.owner_id == user_id)
        .order_by(LiveSession.created_at.desc())
    )
    return [SessionSummary.model_validate(session) for session in result]


@router.get("/code/{code}", response_model=PublicSession)
async def get_session_by_code(code: str, db: AsyncSession = Depends(get_db)) -> PublicSession:
    session = await load_session_by_code(db, code)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session introuvable.")
    participant_count = await db.scalar(
        select(func.count(Participant.id)).where(Participant.session_id == session.id)
    )
    return _public_session(session, participant_count or 0)


@router.post("/code/{code}/join", response_model=ParticipantRead)
async def join_session(
    code: str,
    payload: JoinRequest,
    db: AsyncSession = Depends(get_db),
) -> ParticipantRead:
    session = await load_session_by_code(db, code)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session introuvable.")
    if session.status == "closed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cette session est terminée.")

    nickname = payload.nickname.strip()
    participant = await db.scalar(
        select(Participant).where(
            Participant.session_id == session.id,
            Participant.nickname == nickname,
        )
    )
    if participant is None:
        participant = Participant(session_id=session.id, nickname=nickname)
        db.add(participant)
        await db.commit()
        await db.refresh(participant)

    participant_count = await db.scalar(
        select(func.count(Participant.id)).where(Participant.session_id == session.id)
    )
    await manager.broadcast(
        session.code,
        {
            "type": "participant_joined",
            "nickname": participant.nickname,
            "participant_count": participant_count or 0,
        },
    )
    return ParticipantRead.model_validate(participant)


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> SessionDetail:
    await get_owned_session(db, session_id, user_id)
    session = await load_session_detail(db, session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session introuvable.")
    return SessionDetail.model_validate(session)


@router.patch("/{session_id}", response_model=SessionSummary)
async def update_session(
    session_id: str,
    payload: SessionUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> SessionSummary:
    session = await get_owned_session(db, session_id, user_id)

    if payload.current_activity_id is not None:
        owned = await db.scalar(
            select(LiveSession.id).where(
                LiveSession.id == session_id,
                LiveSession.activities.any(id=payload.current_activity_id),
            )
        )
        if owned is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Activité inconnue.")

    for field in ("title", "status", "current_activity_id"):
        value = getattr(payload, field)
        if value is not None:
            setattr(session, field, value)

    await db.commit()
    await db.refresh(session)

    await manager.broadcast(
        session.code,
        {
            "type": "session_updated",
            "status": session.status,
            "title": session.title,
            "current_activity_id": session.current_activity_id,
        },
    )
    return SessionSummary.model_validate(session)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> None:
    session = await get_owned_session(db, session_id, user_id)
    code = session.code
    await db.delete(session)
    await db.commit()
    await manager.broadcast(code, {"type": "session_deleted"})
