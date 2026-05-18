"""Авторизация Telegram-аккаунта пользователя через MTProto.

Flow:
    1. POST /auth/start  { salon_id, phone }
       → создаём Telethon-клиент, send_code_request
       → шифруем session-state и phone_code_hash, пишем в tg_auth_flows
       → возвращаем { auth_flow_id, state: "awaiting_code" }
       → Telegram присылает 5-значный код в другое TG-устройство юзера

    2. POST /auth/code  { auth_flow_id, code }
       → восстанавливаем клиент из шифрованной session
       → client.sign_in(phone, code, phone_code_hash)
       → если SessionPasswordNeededError → обновляем flow state='awaiting_2fa',
         сохраняем новое state клиента, возвращаем { state: "awaiting_2fa" }
       → иначе: get_me(), insert into tg_sessions (зашифровано),
         flow.state='done', возвращаем { state: "done", session_id }

    3. POST /auth/2fa  { auth_flow_id, password }
       → восстанавливаем клиент, client.sign_in(password=...)
       → get_me(), сохраняем сессию как в шаге 2
"""
from datetime import datetime, timezone
from typing import Literal
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from telethon.errors import (
    PhoneNumberInvalidError,
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    SessionPasswordNeededError,
    PasswordHashInvalidError,
    FloodWaitError,
)

from ..auth_jwt import require_user_id
from ..crypto import decrypt, encrypt
from ..supabase_client import SupabaseClient
from ..tg_client import dump_session, make_client

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger(__name__)


# ============================================================================
# Request / Response models
# ============================================================================


class StartReq(BaseModel):
    salon_id: str
    phone: str = Field(min_length=5, max_length=20, description="E.164 формат, e.g. +48501234567")


class StartResp(BaseModel):
    auth_flow_id: str
    state: Literal["awaiting_code"]


class CodeReq(BaseModel):
    auth_flow_id: str
    code: str = Field(min_length=4, max_length=8)


class TwoFAReq(BaseModel):
    auth_flow_id: str
    password: str = Field(min_length=1, max_length=200)


class AuthDoneResp(BaseModel):
    state: Literal["done"]
    session_id: str
    tg_user_id: int
    tg_username: str | None
    tg_first_name: str | None


class AuthAwaiting2FAResp(BaseModel):
    state: Literal["awaiting_2fa"]


AuthAnyResp = AuthDoneResp | AuthAwaiting2FAResp


# ============================================================================
# Endpoints
# ============================================================================


@router.post("/start", response_model=StartResp)
async def auth_start(
    body: StartReq, user_id: str = Depends(require_user_id)
) -> StartResp:
    """Шаг 1: запрос SMS-кода у Telegram."""
    client = make_client(None)
    try:
        await client.connect()
        try:
            sent = await client.send_code_request(body.phone)
        except PhoneNumberInvalidError:
            raise HTTPException(400, "Неверный формат номера телефона")
        except FloodWaitError as e:
            raise HTTPException(429, f"Telegram rate-limit: подождите {e.seconds} сек")

        # Сериализуем in-memory state клиента (auth_key, dc_id) для восстановления
        pending_session = dump_session(client)
    finally:
        await client.disconnect()

    async with SupabaseClient() as sb:
        rows = await sb.insert(
            "tg_auth_flows",
            {
                "salon_id": body.salon_id,
                "user_id": user_id,
                "phone": body.phone,
                "phone_code_hash_encrypted": encrypt(sent.phone_code_hash),
                "pending_session_encrypted": encrypt(pending_session),
                "state": "awaiting_code",
            },
        )
    return StartResp(auth_flow_id=rows[0]["id"], state="awaiting_code")


@router.post("/code", response_model=AuthAnyResp)
async def auth_code(
    body: CodeReq, user_id: str = Depends(require_user_id)
) -> AuthAnyResp:
    """Шаг 2: ввод кода из Telegram."""
    flow = await _load_flow(body.auth_flow_id, user_id)

    client = make_client(decrypt(flow["pending_session_encrypted"]))
    phone_code_hash = decrypt(flow["phone_code_hash_encrypted"])

    try:
        await client.connect()
        try:
            await client.sign_in(
                phone=flow["phone"],
                code=body.code,
                phone_code_hash=phone_code_hash,
            )
        except PhoneCodeInvalidError:
            raise HTTPException(400, "Неверный код")
        except PhoneCodeExpiredError:
            raise HTTPException(400, "Код истёк, запросите заново")
        except SessionPasswordNeededError:
            # 2FA включена — сохраняем обновлённое состояние клиента и просим пароль
            new_state = dump_session(client)
            await _update_flow(
                flow["id"],
                {"state": "awaiting_2fa", "pending_session_encrypted": encrypt(new_state)},
            )
            return AuthAwaiting2FAResp(state="awaiting_2fa")

        # Sign-in успех без 2FA → сохраняем session
        return await _finalize_session(client, flow)
    finally:
        await client.disconnect()


@router.post("/2fa", response_model=AuthDoneResp)
async def auth_2fa(
    body: TwoFAReq, user_id: str = Depends(require_user_id)
) -> AuthDoneResp:
    """Шаг 3: ввод пароля 2FA (если включён у юзера)."""
    flow = await _load_flow(body.auth_flow_id, user_id, expected_state="awaiting_2fa")

    client = make_client(decrypt(flow["pending_session_encrypted"]))
    try:
        await client.connect()
        try:
            await client.sign_in(password=body.password)
        except PasswordHashInvalidError:
            raise HTTPException(400, "Неверный пароль 2FA")

        result = await _finalize_session(client, flow)
        return result  # type: ignore[return-value]
    finally:
        await client.disconnect()


# ============================================================================
# Helpers
# ============================================================================


async def _load_flow(
    flow_id: str, user_id: str, expected_state: str = "awaiting_code"
) -> dict:
    async with SupabaseClient() as sb:
        rows = await sb.select(
            "tg_auth_flows",
            filters={"id": f"eq.{flow_id}", "user_id": f"eq.{user_id}"},
            limit=1,
        )
    if not rows:
        raise HTTPException(404, "Auth flow not found")
    flow = rows[0]

    if flow["state"] == "done":
        raise HTTPException(400, "Этот auth flow уже завершён")
    if flow["state"] == "expired" or _is_expired(flow["expires_at"]):
        raise HTTPException(400, "Auth flow истёк, начните заново")
    if expected_state == "awaiting_2fa" and flow["state"] != "awaiting_2fa":
        raise HTTPException(400, "2FA не запрошена для этого flow")
    return flow


def _is_expired(iso: str) -> bool:
    """Парсит Postgres timestamptz ('2026-05-18T20:00:00+00:00') и сравнивает с now."""
    # Postgres иногда возвращает '+00:00' и иногда 'Z' — обрабатываем оба
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    dt = datetime.fromisoformat(iso)
    return dt < datetime.now(timezone.utc)


async def _update_flow(flow_id: str, patch: dict) -> None:
    async with SupabaseClient() as sb:
        await sb.update("tg_auth_flows", {"id": f"eq.{flow_id}"}, patch)


async def _finalize_session(client, flow: dict) -> AuthDoneResp:
    """Получает профиль юзера, сохраняет зашифрованную сессию в tg_sessions,
    помечает flow=done."""
    me = await client.get_me()
    session_string = dump_session(client)

    async with SupabaseClient() as sb:
        # UPSERT: если у юзера уже есть сессия в этом салоне — заменяем
        # (юзер мог logout + reconnect новым телефоном). Unique по (salon_id, user_id).
        session_rows = await sb.upsert(
            "tg_sessions",
            {
                "salon_id": flow["salon_id"],
                "user_id": flow["user_id"],
                "phone": flow["phone"],
                "session_encrypted": encrypt(session_string),
                "tg_user_id": me.id,
                "tg_username": me.username,
                "tg_first_name": me.first_name,
                "tg_last_name": me.last_name,
                "status": "active",
                "last_seen_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="salon_id,user_id",
        )
        await sb.update(
            "tg_auth_flows",
            {"id": f"eq.{flow['id']}"},
            {"state": "done", "pending_session_encrypted": None},
        )

    log.info(
        "auth ok: user=%s salon=%s tg_id=%s @%s",
        flow["user_id"], flow["salon_id"], me.id, me.username,
    )
    return AuthDoneResp(
        state="done",
        session_id=session_rows[0]["id"],
        tg_user_id=me.id,
        tg_username=me.username,
        tg_first_name=me.first_name,
    )
