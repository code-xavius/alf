import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_alf.db")
os.environ.setdefault("DEV_MODE", "true")

import pytest_asyncio  # noqa: E402

from app.db import Base, engine  # noqa: E402


@pytest_asyncio.fixture(autouse=True)
async def clean_database():
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    yield
