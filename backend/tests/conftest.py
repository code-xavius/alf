import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_alf.db")
os.environ.setdefault("DEV_MODE", "true")

import pytest_asyncio  # noqa: E402

from app.db import Base, engine, init_db  # noqa: E402


@pytest_asyncio.fixture(autouse=True)
async def clean_database():
    await init_db()
    async with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            await connection.execute(table.delete())
    yield
