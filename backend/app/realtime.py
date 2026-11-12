import asyncio
from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    """Keeps one room of WebSocket connections per session code.

    Rooms live in memory. That is enough for a single backend instance, which
    is the target low-cost deployment. To scale horizontally, replace the
    in-memory fan-out with Redis pub/sub.
    """

    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, code: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._rooms[code].add(websocket)

    async def disconnect(self, code: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._rooms[code].discard(websocket)
            if not self._rooms[code]:
                self._rooms.pop(code, None)

    def count(self, code: str) -> int:
        return len(self._rooms.get(code, ()))

    async def broadcast(self, code: str, message: dict[str, Any]) -> None:
        async with self._lock:
            targets = list(self._rooms.get(code, ()))

        for websocket in targets:
            try:
                await websocket.send_json(message)
            except Exception:  # noqa: BLE001 - a dead socket must not break others
                await self.disconnect(code, websocket)


manager = ConnectionManager()
