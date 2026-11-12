from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..config import settings
from ..schemas import AppConfigOut, MeOut

router = APIRouter(tags=["system"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config", response_model=AppConfigOut)
async def app_config() -> AppConfigOut:
    return AppConfigOut(
        app_name=settings.app_name,
        dev_mode=settings.dev_mode,
        supabase_url=settings.supabase_url,
        supabase_anon_key=settings.supabase_anon_key,
    )


@router.get("/me", response_model=MeOut)
async def me(user_id: str = Depends(get_current_user)) -> MeOut:
    return MeOut(user_id=user_id)
