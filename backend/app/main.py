import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import init_db
from .realtime import manager
from .routers import activities, questions, system, words

logger = logging.getLogger("alf")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if settings.dev_mode:
        logger.warning(
            "DEV_MODE is enabled: authentication is bypassed. "
            "Set DEV_MODE=false before deploying."
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
            # Participants only listen; receiving keeps the connection alive.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(code, websocket)
        await manager.broadcast(code, {"type": "presence", "count": manager.count(code)})


frontend_dir = Path(settings.frontend_dir) if settings.frontend_dir else None
if frontend_dir and frontend_dir.exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
