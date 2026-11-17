import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .config import settings
from .db import SessionLocal, init_db
from .deps import load_activity_by_code
from .realtime import manager
from .routers import activities, questions, system, words
from .routers.words import add_word
from .schemas import WordCreate

logger = logging.getLogger("alf")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if settings.dev_mode:
        logger.warning(
            "DEV_MODE is enabled: authentication is bypassed. "
            "Set DEV_MODE=false before deploying."
        )
    if settings.realtime_url and not settings.internal_token:
        logger.warning(
            "REALTIME_URL is set but INTERNAL_TOKEN is missing: "
            "Cloudflare publishing and word batching will fail."
        )
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (system, activities, words, questions):
    app.include_router(module.router, prefix=settings.api_prefix)


@app.websocket("/ws/{code}")
async def websocket_endpoint(websocket: WebSocket, code: str) -> None:
    code = code.upper()
    await manager.connect(code, websocket)
    await manager.broadcast(code, {"type": "presence", "count": manager.count(code)})
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict) or payload.get("type") != "word":
                continue
            try:
                word = WordCreate(
                    text=payload.get("text"),
                    participant_id=payload.get("participant_id"),
                )
            except ValidationError:
                continue
            async with SessionLocal() as db:
                activity = await load_activity_by_code(db, code)
                if activity is None:
                    continue
                try:
                    await add_word(activity.id, word, db)
                except HTTPException:
                    continue
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(code, websocket)
        await manager.broadcast(code, {"type": "presence", "count": manager.count(code)})


frontend_dir = Path(settings.frontend_dir) if settings.frontend_dir else None
if frontend_dir and frontend_dir.exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
