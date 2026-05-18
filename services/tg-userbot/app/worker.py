"""Background worker: подключает все active tg_sessions, слушает входящие
сообщения, обрабатывает очередь исходящих действий (tg_outbox).

Запускается при старте FastAPI app (см. main.py lifespan).

Дизайн:
- На старте загружаем все tg_sessions where status='active'
- Для каждой создаём TelegramClient(StringSession(decrypt(...))) и run_until_disconnected в task
- Параллельно — outbox-poll loop: каждую секунду читаем tg_outbox where status='pending'
  и dispatch'им к соответствующему клиенту
- Каждые 60 сек — refresh_sessions: проверяем не появилась ли новая active сессия
  (после auth flow), если да — поднимаем её
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from telethon import TelegramClient, events
from telethon.tl.custom import Message

from .crypto import decrypt
from .supabase_client import SupabaseClient
from .tg_client import make_client

log = logging.getLogger(__name__)


@dataclass
class RunningSession:
    session_id: str
    salon_id: str
    user_id: str
    client: TelegramClient
    task: asyncio.Task


class Worker:
    def __init__(self) -> None:
        self.sessions: dict[str, RunningSession] = {}
        self._stop = asyncio.Event()
        self._refresh_task: asyncio.Task | None = None
        self._outbox_task: asyncio.Task | None = None

    async def start(self) -> None:
        log.info("Worker starting")
        # Стартуем refresh + outbox loops в любом случае; если БД ещё не готова
        # (миграция не применена) — они залогируют ошибку и попробуют через 30с.
        try:
            await self._refresh_sessions()
        except Exception as e:
            log.warning("initial refresh_sessions failed (will retry): %s", e)
        self._refresh_task = asyncio.create_task(self._refresh_loop(), name="tg-refresh")
        self._outbox_task = asyncio.create_task(self._outbox_loop(), name="tg-outbox")

    async def stop(self) -> None:
        log.info("Worker stopping")
        self._stop.set()
        for s in list(self.sessions.values()):
            await self._stop_session(s)
        for t in (self._refresh_task, self._outbox_task):
            if t:
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass

    # ------------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------------

    async def _refresh_loop(self) -> None:
        """Каждые 30 сек проверяем не появились ли новые active сессии (после
        auth flow), и не пропали ли существующие (logout / status=revoked)."""
        while not self._stop.is_set():
            try:
                await asyncio.sleep(30)
                if self._stop.is_set():
                    break
                await self._refresh_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.exception("refresh_sessions error: %s", e)

    async def _refresh_sessions(self) -> None:
        async with SupabaseClient() as sb:
            rows = await sb.select(
                "tg_sessions",
                columns="id,salon_id,user_id,session_encrypted",
                filters={"status": "eq.active"},
            )
        wanted = {r["id"] for r in rows}
        # Стартуем новые
        for r in rows:
            if r["id"] not in self.sessions:
                await self._start_session(r)
        # Останавливаем те, что перестали быть active
        for sid in list(self.sessions.keys()):
            if sid not in wanted:
                await self._stop_session(self.sessions[sid])

    async def _start_session(self, row: dict) -> None:
        sid = row["id"]
        try:
            session_string = decrypt(row["session_encrypted"])
        except Exception as e:
            log.error("decrypt session %s failed: %s", sid, e)
            await self._mark_session_error(sid, f"decrypt failed: {e}")
            return

        client = make_client(session_string)
        try:
            await client.connect()
            if not await client.is_user_authorized():
                log.warning("session %s not authorized (revoked on TG side)", sid)
                await self._mark_session_error(sid, "unauthorized", status="unauthorized")
                await client.disconnect()
                return
        except Exception as e:
            log.exception("connect session %s failed", sid)
            await self._mark_session_error(sid, f"connect failed: {e}")
            return

        # Регистрируем хэндлер на новые входящие
        client.add_event_handler(
            self._make_new_message_handler(sid),
            events.NewMessage(incoming=True),
        )

        task = asyncio.create_task(client.run_until_disconnected(), name=f"tg-{sid[:8]}")
        self.sessions[sid] = RunningSession(
            session_id=sid,
            salon_id=row["salon_id"],
            user_id=row["user_id"],
            client=client,
            task=task,
        )
        log.info("started session %s", sid)

    async def _stop_session(self, s: RunningSession) -> None:
        try:
            await s.client.disconnect()
        except Exception:
            pass
        s.task.cancel()
        try:
            await s.task
        except (asyncio.CancelledError, Exception):
            pass
        self.sessions.pop(s.session_id, None)
        log.info("stopped session %s", s.session_id)

    async def _mark_session_error(
        self, sid: str, error: str, *, status: str = "error"
    ) -> None:
        async with SupabaseClient() as sb:
            await sb.update(
                "tg_sessions",
                {"id": f"eq.{sid}"},
                {"status": status, "last_error": error},
            )

    # ------------------------------------------------------------------------
    # Incoming messages
    # ------------------------------------------------------------------------

    def _make_new_message_handler(self, session_id: str):
        async def handler(event: events.NewMessage.Event) -> None:
            try:
                await self._persist_message(session_id, event.message)
            except Exception:
                log.exception("persist message failed (session=%s)", session_id)
        return handler

    async def _persist_message(self, session_id: str, msg: Message) -> None:
        """Сохраняет новое входящее сообщение в tg_messages + обновляет dialog."""
        chat = await msg.get_chat()
        async with SupabaseClient() as sb:
            # Upsert dialog
            dialog_rows = await sb.upsert(
                "tg_dialogs",
                {
                    "session_id": session_id,
                    "tg_chat_id": chat.id,
                    "type": _chat_type(chat),
                    "title": _chat_title(chat),
                    "username": getattr(chat, "username", None),
                    "last_message_text": msg.message or _media_kind(msg) or "",
                    "last_message_at": msg.date.isoformat(),
                    "last_message_from_id": msg.sender_id,
                    "unread_count": 1,  # инкремент полноценно сделаем позже
                },
                on_conflict="session_id,tg_chat_id",
            )
            dialog_id = dialog_rows[0]["id"]

            await sb.upsert(
                "tg_messages",
                {
                    "session_id": session_id,
                    "dialog_id": dialog_id,
                    "tg_message_id": msg.id,
                    "from_tg_user_id": msg.sender_id,
                    "is_outgoing": False,
                    "text": msg.message,
                    "media_kind": _media_kind(msg),
                    "reply_to_tg_message_id": msg.reply_to_msg_id,
                    "sent_at": msg.date.isoformat(),
                },
                on_conflict="session_id,tg_message_id",
            )

    # ------------------------------------------------------------------------
    # Outbox — исходящие действия от SPA
    # ------------------------------------------------------------------------

    async def _outbox_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.sleep(1)
                if not self.sessions:
                    continue
                await self._process_outbox()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.exception("outbox loop error: %s", e)

    async def _process_outbox(self) -> None:
        session_ids = list(self.sessions.keys())
        if not session_ids:
            return
        # Берём максимум 20 pending за тик. session_id фильтруем «in.(...)».
        async with SupabaseClient() as sb:
            rows = await sb.select(
                "tg_outbox",
                filters={
                    "status": "eq.pending",
                    "session_id": f"in.({','.join(session_ids)})",
                },
                order="created_at.asc",
                limit=20,
            )
            for row in rows:
                # Помечаем processing, чтобы при reconnect не задвоить
                marked = await sb.update(
                    "tg_outbox",
                    {"id": f"eq.{row['id']}", "status": "eq.pending"},
                    {"status": "processing", "attempts": row["attempts"] + 1},
                )
                if not marked:
                    continue  # кто-то другой уже схватил (на случай нескольких воркеров)
                try:
                    await self._dispatch_outbox(row)
                    await sb.update(
                        "tg_outbox",
                        {"id": f"eq.{row['id']}"},
                        {
                            "status": "sent",
                            "processed_at": datetime.now(timezone.utc).isoformat(),
                            "last_error": None,
                        },
                    )
                except Exception as e:
                    log.exception("outbox dispatch failed (id=%s)", row["id"])
                    await sb.update(
                        "tg_outbox",
                        {"id": f"eq.{row['id']}"},
                        {
                            "status": "failed" if row["attempts"] >= 3 else "pending",
                            "last_error": str(e)[:500],
                        },
                    )

    async def _dispatch_outbox(self, row: dict) -> None:
        s = self.sessions.get(row["session_id"])
        if not s:
            raise RuntimeError(f"session {row['session_id']} not running")

        action = row["action"]
        payload = row["payload"] or {}
        dialog_id = row["dialog_id"]

        async with SupabaseClient() as sb:
            dialog_rows = await sb.select(
                "tg_dialogs",
                columns="tg_chat_id",
                filters={"id": f"eq.{dialog_id}"},
                limit=1,
            ) if dialog_id else []
        tg_chat_id = dialog_rows[0]["tg_chat_id"] if dialog_rows else None

        if action == "send_text":
            if tg_chat_id is None:
                raise ValueError("send_text requires dialog_id")
            msg = await s.client.send_message(
                tg_chat_id,
                payload["text"],
                reply_to=payload.get("reply_to_tg_message_id"),
            )
            # Сохраняем исходящее в tg_messages
            await self._save_outgoing(s.session_id, dialog_id, msg)

        elif action == "mark_read":
            if tg_chat_id is None:
                raise ValueError("mark_read requires dialog_id")
            await s.client.send_read_acknowledge(
                tg_chat_id,
                max_id=payload.get("tg_message_id"),
            )

        elif action == "typing":
            if tg_chat_id is None:
                raise ValueError("typing requires dialog_id")
            async with s.client.action(tg_chat_id, "typing"):
                await asyncio.sleep(3)

        elif action == "delete_message":
            await s.client.delete_messages(tg_chat_id, [payload["tg_message_id"]])

        elif action == "edit_message":
            await s.client.edit_message(
                tg_chat_id, payload["tg_message_id"], payload["text"]
            )

        else:
            raise NotImplementedError(f"action {action!r} not supported yet")

    async def _save_outgoing(self, session_id: str, dialog_id: str | None, msg: Message) -> None:
        if dialog_id is None:
            return
        async with SupabaseClient() as sb:
            await sb.upsert(
                "tg_messages",
                {
                    "session_id": session_id,
                    "dialog_id": dialog_id,
                    "tg_message_id": msg.id,
                    "from_tg_user_id": msg.sender_id,
                    "is_outgoing": True,
                    "text": msg.message,
                    "sent_at": msg.date.isoformat(),
                },
                on_conflict="session_id,tg_message_id",
            )


# ============================================================================
# Helpers
# ============================================================================


def _chat_type(chat: Any) -> str:
    cls = type(chat).__name__
    if cls == "User":
        return "bot" if getattr(chat, "bot", False) else "user"
    if cls in ("Chat", "ChatForbidden"):
        return "group"
    if cls in ("Channel", "ChannelForbidden"):
        # У channel есть megagroup для супергрупп
        return "group" if getattr(chat, "megagroup", False) else "channel"
    return "user"


def _chat_title(chat: Any) -> str:
    if hasattr(chat, "title") and chat.title:
        return chat.title  # group/channel
    parts = [getattr(chat, "first_name", None), getattr(chat, "last_name", None)]
    return " ".join(p for p in parts if p) or getattr(chat, "username", "") or "—"


def _media_kind(msg: Message) -> str | None:
    if msg.photo:
        return "photo"
    if msg.video:
        return "video"
    if msg.voice:
        return "voice"
    if msg.video_note:
        return "video_note"
    if msg.sticker:
        return "sticker"
    if msg.gif:
        return "animation"
    if msg.document:
        return "document"
    return None
