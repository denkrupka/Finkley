"""Валидация Supabase JWT через GoTrue /auth/v1/user endpoint.

Альтернатива локальной проверке подписи (которая требует JWT_SECRET) — спрашиваем
у Supabase: «кто этот токен?». Latency +30-100ms на request, зато не нужен лишний
секрет в bridge env.

Кешируем результат на 30 сек чтобы не дёргать Supabase на каждый poll.
"""
import time
from typing import Tuple
import httpx
from fastapi import Header, HTTPException, status

from .config import get_settings


class AuthError(HTTPException):
    def __init__(self, detail: str):
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


# In-memory cache: token → (user_id, expires_at_unix)
_cache: dict[str, Tuple[str, float]] = {}
_CACHE_TTL = 30.0


async def require_user_id(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: возвращает Supabase user_id (auth.uid) из JWT, или 401.

    Dev shortcut: при ENV=dev можно передать `Bearer dev:<uuid>` для теста без
    реального JWT.
    """
    settings = get_settings()
    if not authorization or not authorization.startswith("Bearer "):
        raise AuthError("Missing Authorization: Bearer header")
    token = authorization.removeprefix("Bearer ").strip()

    if settings.is_dev and token.startswith("dev:"):
        return token.removeprefix("dev:").strip()

    # cache hit
    now = time.time()
    cached = _cache.get(token)
    if cached and cached[1] > now:
        return cached[0]

    # ask Supabase
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": settings.SUPABASE_ANON_KEY,
            },
        )
    if r.status_code == 401:
        raise AuthError("Invalid or expired token")
    if r.status_code >= 400:
        raise AuthError(f"Supabase auth error: {r.status_code}")
    payload = r.json()
    user_id = payload.get("id")
    if not user_id:
        raise AuthError("Supabase did not return user id")

    _cache[token] = (user_id, now + _CACHE_TTL)
    # housekeeping — выгребаем expired
    if len(_cache) > 500:
        for k, (_, exp) in list(_cache.items())[:100]:
            if exp <= now:
                _cache.pop(k, None)
    return user_id
