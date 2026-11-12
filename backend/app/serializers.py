from .models import Activity
from .schemas import PublicActivity, PublicQuestion


def public_activity(activity: Activity, participant_count: int = 0) -> PublicActivity:
    """Serialize an activity for participants, hiding answers until reveal."""
    revealed = bool((activity.state or {}).get("revealed"))
    return PublicActivity(
        id=activity.id,
        code=activity.code,
        kind=activity.kind,
        title=activity.title,
        config=activity.config or {},
        state=activity.state or {},
        status=activity.status,
        participant_count=participant_count,
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
