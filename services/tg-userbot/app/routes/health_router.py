"""GET /health — liveness probe для мониторинга."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "tg-userbot"}
