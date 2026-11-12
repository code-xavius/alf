import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..broadcast import broadcast_activity, participant_count
from ..config import settings
from ..db import get_db
from ..deps import (
    get_owned_activity,
    is_banned,
    load_activity_by_code,
    load_activity_detail,
)
from ..models import Activity, Participant, utcnow
from ..realtime import manager
from ..schemas import (
    ActivityCreate,
    ActivityRead,
    ActivitySummary,
    ActivityUpdate,
    JoinRequest,
    ParticipantAdmin,
    ParticipantBan,
    ParticipantBanOut,
    ParticipantRead,
    PublicActivity,
)
from ..serializers import public_activity

router = APIRouter(tags=["activities"])

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        value = forwarded.split(",", 1)[0].strip()
        return value[:64] or None
    if request.client is not None:
        return request.client.host[:64]
    return None


def _client_user_agent(request: Request) -> str | None:
    value = request.headers.get("user-agent")
    return value[:500] if value else None


async def _generate_code(db: AsyncSession) -> str:
    for _ in range(25):
        code = "".join(secrets.choice(ALPHABET) for _ in range(settings.activity_code_length))
        exists = await db.scalar(select(Activity.id).where(Activity.code == code))
        if exists is None:
            return code
    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Code d'activité indisponible.")


def _default_state(kind: str) -> dict:
    state: dict = {"current_question": 0, "revealed": False}
    if kind == "video":
        state["question_open"] = False
    return state


@router.post("/activities", response_model=ActivityRead, status_code=status.HTTP_201_CREATED)
async def create_activity(
    payload: ActivityCreate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ActivityRead:
    activity = Activity(
        code=await _generate_code(db),
        owner_id=user_id,
        kind=payload.kind,
        title=payload.title.strip(),
        config=payload.config,
        state=_default_state(payload.kind),
    )
    db.add(activity)
    await db.commit()

    activity = await load_activity_detail(db, activity.id)
    if activity is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Activité introuvable.")
    return ActivityRead.model_validate(activity)


@router.get("/activities", response_model=list[ActivitySummary])
async def list_activities(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> list[ActivitySummary]:
    activities = await db.scalars(
        select(Activity)
        .where(Activity.owner_id == user_id)
        .order_by(Activity.created_at.desc())
    )
    summaries: list[ActivitySummary] = []
    for activity in activities:
        summaries.append(
            ActivitySummary(
                id=activity.id,
                code=activity.code,
                kind=activity.kind,
                title=activity.title,
                status=activity.status,
                participant_count=await participant_count(db, activity.id),
                created_at=activity.created_at,
            )
        )
    return summaries


@router.get("/activities/code/{code}", response_model=PublicActivity)
async def get_activity_by_code(code: str, db: AsyncSession = Depends(get_db)) -> PublicActivity:
    activity = await load_activity_by_code(db, code)
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")
    return public_activity(activity, await participant_count(db, activity.id))


@router.post("/activities/code/{code}/join", response_model=ParticipantRead)
async def join_activity(
    code: str,
    payload: JoinRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ParticipantRead:
    activity = await load_activity_by_code(db, code)
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")
    if activity.status == "closed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cette activité est terminée.")

    ip = _client_ip(request)
    user_agent = _client_user_agent(request)
    device_id = (payload.device_id or "").strip() or None
    nickname = payload.nickname.strip()

    participants = await db.scalars(
        select(Participant).where(Participant.activity_id == activity.id)
    )
    for entry in participants:
        if not is_banned(entry):
            continue
        if device_id and entry.device_id:
            blocked = entry.device_id == device_id
        elif device_id is None or entry.device_id is None:
            blocked = bool(ip) and entry.ip == ip and entry.user_agent == user_agent
        else:
            blocked = False
        if blocked:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Vous avez été temporairement exclu de cette activité.",
            )

    participant = await db.scalar(
        select(Participant).where(
            Participant.activity_id == activity.id,
            Participant.nickname == nickname,
        )
    )
    if participant is not None and is_banned(participant):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Vous avez été temporairement exclu de cette activité.",
        )

    if participant is None:
        participant = Participant(
            activity_id=activity.id,
            nickname=nickname,
            ip=ip,
            user_agent=user_agent,
            device_id=device_id,
        )
        db.add(participant)
    else:
        participant.ip = ip
        participant.user_agent = user_agent
        if device_id:
            participant.device_id = device_id

    await db.commit()
    await db.refresh(participant)

    await manager.broadcast(
        activity.code,
        {
            "type": "participant_joined",
            "nickname": participant.nickname,
            "participant_count": await participant_count(db, activity.id),
        },
    )
    return ParticipantRead.model_validate(participant)


@router.get(
    "/activities/{activity_id}/participants",
    response_model=list[ParticipantAdmin],
)
async def list_participants(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> list[ParticipantAdmin]:
    await get_owned_activity(db, activity_id, user_id)
    participants = await db.scalars(
        select(Participant)
        .where(Participant.activity_id == activity_id)
        .order_by(Participant.created_at)
    )
    return [
        ParticipantAdmin(
            id=participant.id,
            nickname=participant.nickname,
            ip=participant.ip,
            user_agent=participant.user_agent,
            device_id=participant.device_id,
            banned_until=participant.banned_until,
            banned=is_banned(participant),
            created_at=participant.created_at,
        )
        for participant in participants
    ]


@router.post(
    "/activities/{activity_id}/participants/{participant_id}/ban",
    response_model=ParticipantBanOut,
)
async def ban_participant(
    activity_id: str,
    participant_id: str,
    payload: ParticipantBan,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ParticipantBanOut:
    activity = await get_owned_activity(db, activity_id, user_id)
    participant = await db.scalar(
        select(Participant).where(
            Participant.id == participant_id,
            Participant.activity_id == activity.id,
        )
    )
    if participant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant introuvable.")

    if payload.minutes <= 0:
        participant.banned_until = None
        event_type = "participant_unbanned"
    else:
        participant.banned_until = utcnow() + timedelta(minutes=payload.minutes)
        event_type = "participant_banned"

    await db.commit()
    await db.refresh(participant)

    await manager.broadcast(
        activity.code,
        {
            "type": event_type,
            "participant_id": participant.id,
            "nickname": participant.nickname,
            "banned_until": participant.banned_until.isoformat()
            if participant.banned_until
            else None,
        },
    )

    return ParticipantBanOut(
        id=participant.id,
        banned_until=participant.banned_until,
    )


@router.get("/activities/{activity_id}", response_model=ActivityRead)
async def get_activity(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ActivityRead:
    await get_owned_activity(db, activity_id, user_id)
    activity = await load_activity_detail(db, activity_id)
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")
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
    if payload.status is not None:
        activity.status = payload.status

    await db.commit()
    activity = await load_activity_detail(db, activity_id)
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activité introuvable.")

    await broadcast_activity(db, activity)
    return ActivityRead.model_validate(activity)


@router.delete("/activities/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_activity(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> None:
    activity = await get_owned_activity(db, activity_id, user_id)
    code = activity.code

    await db.delete(activity)
    await db.commit()

    await manager.broadcast(code, {"type": "activity_deleted"})
