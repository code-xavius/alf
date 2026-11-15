from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Activity, Participant
from .realtime_publisher import publish
from .serializers import public_activity


async def participant_count(db: AsyncSession, activity_id: str) -> int:
    count = await db.scalar(
        select(func.count(Participant.id)).where(Participant.activity_id == activity_id)
    )
    return count or 0


async def broadcast_activity(db: AsyncSession, activity: Activity) -> None:
    count = await participant_count(db, activity.id)
    await publish(
        activity.code,
        {
            "type": "activity_updated",
            "activity": public_activity(activity, count).model_dump(mode="json"),
        },
    )
