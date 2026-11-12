from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    """Base class for every database model."""


def _engine_options() -> dict:
    options: dict = {"echo": False, "pool_pre_ping": True}

    # Supabase's transaction pooler does not support prepared statements.
    if settings.database_url.startswith("postgresql+asyncpg"):
        options["connect_args"] = {"statement_cache_size": 0}

    return options


engine = create_async_engine(settings.database_url, **_engine_options())
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    from . import models  # noqa: F401  (register the models)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
