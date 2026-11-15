import logging
from urllib.parse import urlsplit, urlunsplit

import httpx

from .config import settings
from .realtime import manager

logger = logging.getLogger("alf.realtime")


def _http_base(url: str) -> str:
    parts = urlsplit(url.strip())
    scheme = "https" if parts.scheme in {"https", "wss"} else "http"
    return urlunsplit((scheme, parts.netloc, parts.path.rstrip("/"), "", ""))


async def publish(code: str, message: dict) -> None:
    """Publish a realtime event to the Cloudflare hub, or the local fallback."""
    if settings.realtime_url and settings.internal_token:
        url = f"{_http_base(settings.realtime_url)}/rooms/{code.upper()}/broadcast"
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.post(
                    url,
                    json=message,
                    headers={"x-alf-internal-token": settings.internal_token},
                )
            if response.status_code >= 400:
                logger.warning(
                    "Realtime publish failed for %s: %s %s",
                    code,
                    response.status_code,
                    response.text[:200],
                )
        except Exception as exc:  # noqa: BLE001 - realtime must not break requests
            logger.warning("Realtime publish failed for %s: %s", code, exc)
        return

    await manager.broadcast(code, message)
