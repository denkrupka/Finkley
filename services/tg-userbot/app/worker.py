"""Background worker: подключает все active tg_sessions, слушает входящие
сообщения, обрабатывает очередь исходящих действий (tg_outbox).

Что делает:
- На старте загружает все tg_sessions WHERE status='active'
- Для каждой:
  1. Если bootstrap_completed_at IS NULL — забирает get_dialogs() (последние 50)
     и последние 20 сообщений в каждом → пишет в tg_dialogs / tg_messages
  2. Регистрирует handlers: NewMessage(incoming + outgoing) — для сохранения
     новых сообщений; MessageEdited; MessageRead (outgoing=True для read receipts)
  3. Запускает client.run_until_disconnected() в фоне
- Параллельно — outbox-poll loop: каждую секунду читает tg_outbox WHERE status='pending'
  и dispatch'ит в соответствующий клиент (send_text / send_photo / mark_read / typing)
- Каждые 30 сек — refresh_sessions: подхватывает новые active сессии и
  останавливает revoked.
"""
from __future__ import annotations

import asyncio
import io
import logging
import mimetypes
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

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
                columns="id,salon_id,user_id,session_encrypted,bootstrap_completed_at",
                filters={"status": "eq.active"},
            )
        wanted = {r["id"] for r in rows}
        for r in rows:
            if r["id"] not in self.sessions:
                await self._start_session(r)
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

        # Регистрируем обработчики событий до bootstrap'а, чтобы не упустить
        # сообщения которые придут пока мы качаем историю.
        client.add_event_handler(
            self._make_new_message_handler(sid), events.NewMessage(incoming=True)
        )
        client.add_event_handler(
            self._make_new_message_handler(sid), events.NewMessage(outgoing=True)
        )
        client.add_event_handler(
            self._make_message_edited_handler(sid), events.MessageEdited()
        )
        # inbox=False = events о прочтении НАШИХ outgoing сообщений другими
        client.add_event_handler(
            self._make_message_read_handler(sid), events.MessageRead(inbox=False)
        )
        client.add_event_handler(
            self._make_message_deleted_handler(sid), events.MessageDeleted()
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

        # Bootstrap: если не делали — делаем сейчас
        if not row.get("bootstrap_completed_at"):
            asyncio.create_task(self._bootstrap_session(sid, client), name=f"bootstrap-{sid[:8]}")

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
    # Bootstrap — первичная загрузка диалогов + истории
    # ------------------------------------------------------------------------

    async def _bootstrap_session(self, sid: str, client: TelegramClient) -> None:
        """При первом подключении тащим последние 50 диалогов + 20 сообщений
        каждого, чтобы юзер сразу видел свою TG-историю в портале."""
        log.info("bootstrap session %s — loading dialogs", sid)
        try:
            dialogs = await client.get_dialogs(limit=50)
            log.info("bootstrap %s: %d dialogs", sid, len(dialogs))
            for dlg in dialogs:
                try:
                    await self._save_dialog(sid, dlg.entity, last_msg=dlg.message,
                                            unread_count=dlg.unread_count or 0,
                                            pinned=bool(dlg.pinned),
                                            archived=bool(dlg.archived))
                    # Подтягиваем последние 20 сообщений
                    messages = await client.get_messages(dlg.entity, limit=20)
                    for msg in reversed(messages):  # старые → новые
                        if msg.id:
                            await self._persist_message(sid, msg, client, skip_dialog_update=True)
                except Exception:
                    log.exception("bootstrap dialog %s in session %s failed", dlg.entity, sid)

            # Помечаем что bootstrap завершён
            async with SupabaseClient() as sb:
                await sb.update(
                    "tg_sessions",
                    {"id": f"eq.{sid}"},
                    {
                        "bootstrap_completed_at": datetime.now(timezone.utc).isoformat(),
                        "last_seen_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
            log.info("bootstrap session %s — done", sid)
        except Exception:
            log.exception("bootstrap session %s failed", sid)

    # ------------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------------

    def _make_new_message_handler(self, session_id: str):
        async def handler(event: events.NewMessage.Event) -> None:
            try:
                s = self.sessions.get(session_id)
                if s:
                    await self._persist_message(session_id, event.message, s.client)
            except Exception:
                log.exception("persist message failed (session=%s)", session_id)
        return handler

    def _make_message_edited_handler(self, session_id: str):
        async def handler(event: events.MessageEdited.Event) -> None:
            try:
                msg = event.message
                async with SupabaseClient() as sb:
                    await sb.update(
                        "tg_messages",
                        {
                            "session_id": f"eq.{session_id}",
                            "tg_message_id": f"eq.{msg.id}",
                        },
                        {
                            "text": msg.message,
                            "edited_at": (msg.edit_date or datetime.now(timezone.utc)).isoformat(),
                        },
                    )
            except Exception:
                log.exception("edit message failed (session=%s)", session_id)
        return handler

    def _make_message_read_handler(self, session_id: str):
        """events.MessageRead(outbox=True) фиров когда КТО-ТО прочитал наше
        исходящее сообщение. Заполняем read_by_recipient_at у всех outgoing
        сообщений в этом chat с tg_message_id <= max_id."""
        async def handler(event: events.MessageRead.Event) -> None:
            try:
                chat_id = event.chat_id
                max_id = event.max_id
                now_iso = datetime.now(timezone.utc).isoformat()
                async with SupabaseClient() as sb:
                    # Находим dialog по chat_id
                    dialog_rows = await sb.select(
                        "tg_dialogs",
                        columns="id",
                        filters={
                            "session_id": f"eq.{session_id}",
                            "tg_chat_id": f"eq.{chat_id}",
                        },
                        limit=1,
                    )
                    if not dialog_rows:
                        return
                    dialog_id = dialog_rows[0]["id"]
                    await sb.update(
                        "tg_messages",
                        {
                            "dialog_id": f"eq.{dialog_id}",
                            "is_outgoing": "eq.true",
                            "tg_message_id": f"lte.{max_id}",
                            "read_by_recipient_at": "is.null",
                        },
                        {"read_by_recipient_at": now_iso},
                    )
            except Exception:
                log.exception("message read failed (session=%s)", session_id)
        return handler

    def _make_message_deleted_handler(self, session_id: str):
        async def handler(event: events.MessageDeleted.Event) -> None:
            try:
                async with SupabaseClient() as sb:
                    # Telethon даёт список ID удалённых сообщений
                    for msg_id in event.deleted_ids:
                        await sb.update(
                            "tg_messages",
                            {
                                "session_id": f"eq.{session_id}",
                                "tg_message_id": f"eq.{msg_id}",
                            },
                            {"deleted": True},
                        )
            except Exception:
                log.exception("delete message failed (session=%s)", session_id)
        return handler

    # ------------------------------------------------------------------------
    # Persist
    # ------------------------------------------------------------------------

    async def _save_dialog(
        self,
        session_id: str,
        chat: Any,
        *,
        last_msg: Message | None = None,
        unread_count: int = 0,
        pinned: bool = False,
        archived: bool = False,
    ) -> str:
        """Upsert tg_dialogs запись. Возвращает dialog_id (uuid)."""
        async with SupabaseClient() as sb:
            row = {
                "session_id": session_id,
                "tg_chat_id": chat.id,
                "type": _chat_type(chat),
                "title": _chat_title(chat),
                "username": getattr(chat, "username", None),
                "unread_count": unread_count,
                "pinned": pinned,
                "archived": archived,
            }
            if last_msg is not None:
                row["last_message_text"] = last_msg.message or _media_kind(last_msg) or ""
                row["last_message_at"] = last_msg.date.isoformat()
                row["last_message_from_id"] = last_msg.sender_id
            rows = await sb.upsert(
                "tg_dialogs", row, on_conflict="session_id,tg_chat_id"
            )
            return rows[0]["id"]

    async def _persist_message(
        self,
        session_id: str,
        msg: Message,
        client: TelegramClient,
        *,
        skip_dialog_update: bool = False,
    ) -> None:
        """Сохраняет сообщение в tg_messages + (опц.) обновляет dialog preview.
        Скачивает медиа в Supabase Storage если есть."""
        chat = await msg.get_chat()
        dialog_id = await self._save_dialog(
            session_id, chat,
            last_msg=None if skip_dialog_update else msg,
            unread_count=0 if msg.out else 1,
        )

        media_kind = _media_kind(msg)
        media_path: str | None = None
        media_mime: str | None = None
        media_size: int | None = None

        # Скачиваем медиа (фото/видео/документ) — только при первичной обработке.
        # Видео и большие документы пропускаем чтобы не забивать диск на E2.1.Micro.
        if media_kind in ("photo", "voice", "sticker"):
            try:
                buf = io.BytesIO()
                await client.download_media(msg, file=buf)
                blob = buf.getvalue()
                if blob:
                    ext = _media_extension(msg, media_kind)
                    media_path = f"{session_id}/{msg.id}{ext}"
                    media_mime = mimetypes.guess_type(media_path)[0] or "application/octet-stream"
                    media_size = len(blob)
                    async with SupabaseClient() as sb:
                        await sb.storage_upload(
                            "tg-media", media_path, blob, content_type=media_mime
                        )
            except Exception:
                log.exception("media download failed (msg=%s)", msg.id)

        async with SupabaseClient() as sb:
            await sb.upsert(
                "tg_messages",
                {
                    "session_id": session_id,
                    "dialog_id": dialog_id,
                    "tg_message_id": msg.id,
                    "from_tg_user_id": msg.sender_id,
                    "is_outgoing": bool(msg.out),
                    "text": msg.message,
                    "media_kind": media_kind,
                    "media_path": media_path,
                    "media_mime_type": media_mime,
                    "media_size_bytes": media_size,
                    "media_caption": msg.message if media_kind and msg.message else None,
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
                marked = await sb.update(
                    "tg_outbox",
                    {"id": f"eq.{row['id']}", "status": "eq.pending"},
                    {"status": "processing", "attempts": row["attempts"] + 1},
                )
                if not marked:
                    continue
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
            sent = await s.client.send_message(
                tg_chat_id,
                payload["text"],
                reply_to=payload.get("reply_to_tg_message_id"),
            )
            # NewMessage handler сам сохранит outgoing — но он может не успеть
            # к моменту UPDATE outbox.status='sent'. Поэтому явно сохраняем тут.
            await self._persist_message(s.session_id, sent, s.client, skip_dialog_update=False)

        elif action == "send_photo":
            if tg_chat_id is None:
                raise ValueError("send_photo requires dialog_id")
            # payload: { storage_path: 'tg-media/upload/...', caption?: '...' }
            storage_path = payload["storage_path"]
            caption = payload.get("caption")
            # Скачиваем из Supabase Storage в bytes, потом передаём в send_file
            blob = await self._fetch_storage_blob("tg-media", storage_path)
            sent = await s.client.send_file(
                tg_chat_id,
                file=io.BytesIO(blob),
                caption=caption,
                attributes=[],
                force_document=False,
            )
            await self._persist_message(s.session_id, sent, s.client)

        elif action == "mark_read":
            if tg_chat_id is None:
                raise ValueError("mark_read requires dialog_id")
            await s.client.send_read_acknowledge(
                tg_chat_id, max_id=payload.get("tg_message_id")
            )
            # Обнуляем local unread_count на dialog'е
            async with SupabaseClient() as sb:
                await sb.update(
                    "tg_dialogs",
                    {"id": f"eq.{dialog_id}"},
                    {"unread_count": 0},
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

    async def _fetch_storage_blob(self, bucket: str, path: str) -> bytes:
        """Скачивает blob из Supabase Storage используя service_role key."""
        from .config import get_settings
        import httpx
        s = get_settings()
        url = f"{s.SUPABASE_URL.rstrip('/')}/storage/v1/object/{bucket}/{path}"
        async with httpx.AsyncClient(timeout=60.0) as cli:
            r = await cli.get(
                url,
                headers={
                    "apikey": s.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {s.SUPABASE_SERVICE_ROLE_KEY}",
                },
            )
            if r.status_code >= 400:
                raise RuntimeError(f"fetch storage {bucket}/{path} failed: {r.status_code} {r.text}")
            return r.content


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
        return "group" if getattr(chat, "megagroup", False) else "channel"
    return "user"


def _chat_title(chat: Any) -> str:
    if hasattr(chat, "title") and chat.title:
        return chat.title
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


def _media_extension(msg: Message, kind: str) -> str:
    """Подбирает расширение файла для скачанного медиа."""
    if kind == "photo":
        return ".jpg"
    if kind == "voice":
        return ".ogg"
    if kind == "sticker":
        # tgs (animated) или webp (static)
        if msg.sticker and msg.sticker.mime_type:
            return mimetypes.guess_extension(msg.sticker.mime_type) or ".webp"
        return ".webp"
    if kind == "video":
        return ".mp4"
    if kind == "video_note":
        return ".mp4"
    if kind == "animation":
        return ".mp4"
    if kind == "document" and msg.document:
        # Берём оригинальное имя если есть
        for attr in msg.document.attributes:
            if hasattr(attr, "file_name") and attr.file_name:
                return os.path.splitext(attr.file_name)[1] or ".bin"
        return mimetypes.guess_extension(msg.document.mime_type or "") or ".bin"
    return ".bin"
