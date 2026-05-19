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
        self._cleanup_task: asyncio.Task | None = None

    async def start(self) -> None:
        log.info("Worker starting")
        try:
            await self._refresh_sessions()
        except Exception as e:
            log.warning("initial refresh_sessions failed (will retry): %s", e)
        self._refresh_task = asyncio.create_task(self._refresh_loop(), name="tg-refresh")
        self._outbox_task = asyncio.create_task(self._outbox_loop(), name="tg-outbox")
        self._cleanup_task = asyncio.create_task(self._cleanup_loop(), name="tg-cleanup")

    async def stop(self) -> None:
        log.info("Worker stopping")
        self._stop.set()
        for s in list(self.sessions.values()):
            await self._stop_session(s)
        for t in (self._refresh_task, self._outbox_task, self._cleanup_task):
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
        # Raw handler для реакций — Telethon не даёт высокоуровневого события.
        from telethon.tl.types import UpdateMessageReactions, UpdateBotMessageReactions
        client.add_event_handler(
            self._make_reactions_handler(sid),
            events.Raw(types=(UpdateMessageReactions, UpdateBotMessageReactions)),
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

        # Bootstrap: если не делали — делаем сейчас. Иначе — догоняем аватарки
        # для уже существующих диалогов (один раз, для сессий созданных до того
        # как worker умел качать photo_path).
        if not row.get("bootstrap_completed_at"):
            asyncio.create_task(self._bootstrap_session(sid, client), name=f"bootstrap-{sid[:8]}")
        else:
            asyncio.create_task(self._catch_up_avatars(sid, client), name=f"avatars-{sid[:8]}")

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
            # Свою аватарку (для шапки профиля)
            try:
                me_photo_path = await self._download_avatar(sid, client, "me", target_key="me")
                if me_photo_path:
                    async with SupabaseClient() as sb:
                        await sb.update(
                            "tg_sessions",
                            {"id": f"eq.{sid}"},
                            {"tg_photo_path": me_photo_path},
                        )
            except Exception:
                log.exception("bootstrap me avatar failed (session=%s)", sid)

            dialogs = await client.get_dialogs(limit=50)
            log.info("bootstrap %s: %d dialogs", sid, len(dialogs))
            for dlg in dialogs:
                try:
                    await self._save_dialog(sid, dlg.entity, last_msg=dlg.message,
                                            unread_count=dlg.unread_count or 0,
                                            pinned=bool(dlg.pinned),
                                            archived=bool(dlg.archived),
                                            client=client)
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

    async def _catch_up_avatars(self, sid: str, client: TelegramClient) -> None:
        """Для уже существующих сессий (bootstrap'ом не прошлись с фото) —
        качаем аватарки своего профиля + всех диалогов без photo_path.
        Использует iter_dialogs — entities приходят полные, с access_hash
        и правильным polymorphic photo (User.photo / Channel.photo / Chat.photo).
        Безопасно к повторному запуску (проверяем existing photo_path)."""
        try:
            # Свой аватар
            async with SupabaseClient() as sb:
                me_rows = await sb.select(
                    "tg_sessions",
                    columns="tg_photo_path",
                    filters={"id": f"eq.{sid}"},
                    limit=1,
                )
            if me_rows and not me_rows[0].get("tg_photo_path"):
                try:
                    me_path = await self._download_avatar(sid, client, "me", target_key="me")
                    if me_path:
                        async with SupabaseClient() as sb:
                            await sb.update(
                                "tg_sessions",
                                {"id": f"eq.{sid}"},
                                {"tg_photo_path": me_path},
                            )
                except Exception:
                    log.exception("catch-up me avatar failed")

            # Какие dialog_id в БД ещё без photo_path
            async with SupabaseClient() as sb:
                missing = await sb.select(
                    "tg_dialogs",
                    columns="id,tg_chat_id",
                    filters={"session_id": f"eq.{sid}", "photo_path": "is.null"},
                    limit=500,
                )
            missing_by_chat = {int(r["tg_chat_id"]): r["id"] for r in missing}
            if not missing_by_chat:
                log.info("catch-up avatars: no missing for %s", sid)
                return

            downloaded = 0
            # iter_dialogs даёт полный entity (с photo) и access_hash в кэше.
            async for dlg in client.iter_dialogs(limit=200):
                entity = dlg.entity
                chat_id_int = int(getattr(entity, "id", 0) or 0)
                if chat_id_int not in missing_by_chat:
                    continue
                if not getattr(entity, "photo", None):
                    # ChatPhotoEmpty или None — пропускаем без шума
                    continue
                try:
                    path = await self._download_avatar(
                        sid, client, entity, target_key=str(chat_id_int)
                    )
                    if path:
                        async with SupabaseClient() as sb:
                            await sb.update(
                                "tg_dialogs",
                                {"id": f"eq.{missing_by_chat[chat_id_int]}"},
                                {"photo_path": path},
                            )
                        downloaded += 1
                except Exception:
                    log.debug("catch-up dialog avatar %s failed", chat_id_int, exc_info=True)
                # rate-limit-friendly pause
                await asyncio.sleep(0.3)
            log.info("catch-up avatars done for %s: %d downloaded / %d missing",
                     sid, downloaded, len(missing_by_chat))
        except Exception:
            log.exception("catch_up_avatars failed (session=%s)", sid)

    async def _download_avatar(
        self,
        session_id: str,
        client: TelegramClient,
        entity: Any,
        *,
        target_key: str,
    ) -> str | None:
        """Скачивает аватар entity в tg-media под session_id/avatars/<target_key>.jpg.
        target_key — обычно tg_chat_id (str) или 'me'. Возвращает path или None."""
        buf = io.BytesIO()
        try:
            res = await client.download_profile_photo(entity, file=buf, download_big=False)
        except Exception as e:
            log.debug("download_profile_photo %s failed: %s", target_key, e)
            return None
        if not res:
            return None
        blob = buf.getvalue()
        if not blob:
            return None
        path = f"{session_id}/avatars/{target_key}.jpg"
        async with SupabaseClient() as sb:
            await sb.storage_upload("tg-media", path, blob, content_type="image/jpeg")
        return path

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

    def _make_reactions_handler(self, session_id: str):
        """Raw handler для UpdateMessageReactions — обновляет reactions jsonb."""
        async def handler(update: Any) -> None:
            try:
                # update имеет атрибуты peer (peer chat), msg_id, reactions
                msg_id = getattr(update, "msg_id", None)
                reactions = getattr(update, "reactions", None)
                if msg_id is None or reactions is None:
                    return
                payload = _reactions_to_jsonb(reactions)
                async with SupabaseClient() as sb:
                    await sb.update(
                        "tg_messages",
                        {
                            "session_id": f"eq.{session_id}",
                            "tg_message_id": f"eq.{msg_id}",
                        },
                        {"reactions": payload},
                    )
            except Exception:
                log.exception("reactions update failed (session=%s)", session_id)
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
        client: TelegramClient | None = None,
    ) -> str:
        """Upsert tg_dialogs запись. Возвращает dialog_id (uuid).
        Если передан client и у chat есть photo — скачиваем аватарку в bucket."""
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
            dialog_id = rows[0]["id"]
            existing_photo = rows[0].get("photo_path")

        # Аватарку качаем один раз — только если в БД её ещё нет.
        # client передаётся при bootstrap'е; при обычном _persist_message — None,
        # чтобы не дёргать TG на каждое сообщение.
        if client is not None and not existing_photo and getattr(chat, "photo", None):
            try:
                path = await self._download_avatar(
                    session_id, client, chat, target_key=str(chat.id)
                )
                if path:
                    async with SupabaseClient() as sb:
                        await sb.update(
                            "tg_dialogs",
                            {"id": f"eq.{dialog_id}"},
                            {"photo_path": path},
                        )
            except Exception:
                log.exception("save dialog avatar failed (chat=%s)", chat.id)
        return dialog_id

    async def _persist_message(
        self,
        session_id: str,
        msg: Message,
        client: TelegramClient,
        *,
        skip_dialog_update: bool = False,
    ) -> None:
        """Сохраняет сообщение в tg_messages + (опц.) обновляет dialog preview.
        Lazy: медиа не качается здесь — это делает download_media action когда
        SPA открывает чат. Аватарку диалога подгружаем один раз (если ещё нет
        в БД) — _save_dialog внутри сам это проверяет."""
        chat = await msg.get_chat()
        dialog_id = await self._save_dialog(
            session_id, chat,
            last_msg=None if skip_dialog_update else msg,
            unread_count=0 if msg.out else 1,
            client=client,
        )

        media_kind = _media_kind(msg)
        # Lazy media: НЕ качаем сразу. SPA при открытии чата отправит
        # action='download_media', тогда заполним media_path.
        reactions_payload = _serialize_reactions(msg)

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
                    "media_caption": msg.message if media_kind and msg.message else None,
                    "reply_to_tg_message_id": msg.reply_to_msg_id,
                    "reactions": reactions_payload,
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
                await asyncio.sleep(0.5)
                if not self.sessions:
                    continue
                await self._process_outbox()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.exception("outbox loop error: %s", e)

    async def _process_outbox(self) -> None:
        """Обрабатывает pending outbox.
        - download_media: параллельно (concurrency=5), порядок не важен.
        - остальные actions (send_text/photo/react/mark_read/...): последовательно,
          чтобы сохранить порядок отправки и не флудить TG API.
        """
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
                limit=50,
            )

        downloads: list[dict] = []
        serial: list[dict] = []
        for row in rows:
            if row["action"] == "download_media":
                downloads.append(row)
            else:
                serial.append(row)

        # Serial actions
        if serial:
            async with SupabaseClient() as sb:
                for row in serial:
                    await self._claim_and_run(sb, row)

        # Concurrent downloads (max 5 одновременно)
        if downloads:
            sem = asyncio.Semaphore(5)

            async def run_one(row: dict) -> None:
                async with sem, SupabaseClient() as sb:
                    await self._claim_and_run(sb, row)

            await asyncio.gather(*(run_one(r) for r in downloads), return_exceptions=True)

    async def _claim_and_run(self, sb: SupabaseClient, row: dict) -> None:
        """Marks outbox row as 'processing' (compare-and-swap), dispatches,
        updates final status."""
        marked = await sb.update(
            "tg_outbox",
            {"id": f"eq.{row['id']}", "status": "eq.pending"},
            {"status": "processing", "attempts": row["attempts"] + 1},
        )
        if not marked:
            return
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

        elif action in ("send_photo", "send_video", "send_voice", "send_document"):
            if tg_chat_id is None:
                raise ValueError(f"{action} requires dialog_id")
            # payload: { storage_path: 'upload/<sid>/...', caption?: '...' }
            storage_path = payload["storage_path"]
            caption = payload.get("caption")
            blob = await self._fetch_storage_blob("tg-media", storage_path)
            buf = io.BytesIO(blob)
            # Имя файла нужно чтобы Telethon правильно определил mime
            buf.name = storage_path.rsplit("/", 1)[-1]
            force_document = action == "send_document"
            voice_note = action == "send_voice"
            sent = await s.client.send_file(
                tg_chat_id,
                file=buf,
                caption=caption,
                force_document=force_document,
                voice_note=voice_note,
            )
            await self._persist_message(s.session_id, sent, s.client)
            # После отправки удаляем upload-файл из storage (он уже в TG)
            try:
                async with SupabaseClient() as sb:
                    await sb.storage_delete("tg-media", [storage_path])
            except Exception:
                log.warning("failed to cleanup upload %s", storage_path, exc_info=True)

        elif action == "react":
            if tg_chat_id is None:
                raise ValueError("react requires dialog_id")
            # payload: { tg_message_id, emoji: '👍' | '❤' | ... или null для снятия }
            from telethon.tl.functions.messages import SendReactionRequest
            from telethon.tl.types import ReactionEmoji
            emoji = payload.get("emoji")
            reaction_list = [ReactionEmoji(emoticon=emoji)] if emoji else []
            await s.client(
                SendReactionRequest(
                    peer=tg_chat_id,
                    msg_id=payload["tg_message_id"],
                    reaction=reaction_list,
                )
            )

        elif action == "download_media":
            # SPA-инициированное lazy-скачивание медиа конкретного сообщения.
            # payload: { tg_message_id: number, dialog_id: uuid }
            if tg_chat_id is None:
                raise ValueError("download_media requires dialog_id")
            tg_msg_id = payload["tg_message_id"]
            await self._download_message_media(s.session_id, s.client, tg_chat_id, tg_msg_id)

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

    async def _download_message_media(
        self,
        session_id: str,
        client: TelegramClient,
        tg_chat_id: int,
        tg_message_id: int,
    ) -> None:
        """По требованию SPA (action='download_media') качает медиа конкретного
        сообщения и сохраняет media_path в БД. Лимит: 30 MB на файл (чтобы
        не положить диск VM)."""
        try:
            msgs = await client.get_messages(tg_chat_id, ids=[tg_message_id])
        except Exception as e:
            log.warning("get_messages tg_chat=%s id=%s failed: %s", tg_chat_id, tg_message_id, e)
            return
        if not msgs or msgs[0] is None:
            return
        msg = msgs[0]
        kind = _media_kind(msg)
        if not kind:
            return
        # Лимит по размеру
        size = 0
        if msg.document:
            size = getattr(msg.document, "size", 0) or 0
        elif msg.photo:
            # Фото обычно <5MB, разрешаем безусловно
            size = 0
        if size > 30 * 1024 * 1024:
            log.info("skip media tg_msg=%s — too large (%d bytes)", tg_message_id, size)
            async with SupabaseClient() as sb:
                await sb.update(
                    "tg_messages",
                    {"session_id": f"eq.{session_id}", "tg_message_id": f"eq.{tg_message_id}"},
                    {"media_pending": False},
                )
            return
        buf = io.BytesIO()
        try:
            await client.download_media(msg, file=buf)
        except Exception:
            log.exception("download_media failed for tg_msg=%s", tg_message_id)
            return
        blob = buf.getvalue()
        if not blob:
            return
        ext = _media_extension(msg, kind)
        media_path = f"{session_id}/{tg_message_id}{ext}"
        media_mime = mimetypes.guess_type(media_path)[0] or "application/octet-stream"
        async with SupabaseClient() as sb:
            await sb.storage_upload("tg-media", media_path, blob, content_type=media_mime)
            await sb.update(
                "tg_messages",
                {"session_id": f"eq.{session_id}", "tg_message_id": f"eq.{tg_message_id}"},
                {
                    "media_path": media_path,
                    "media_mime_type": media_mime,
                    "media_size_bytes": len(blob),
                    "media_pending": False,
                },
            )

    # ------------------------------------------------------------------------
    # Cleanup loop — удаляет старые медиа из storage (TTL 5 мин после закрытия)
    # ------------------------------------------------------------------------

    async def _cleanup_loop(self) -> None:
        """Каждую минуту:
          - находит tg_messages с media_path != null где dialog был закрыт > 5 мин
            назад (или никогда не был открыт, но фото уже есть — legacy bootstrap)
          - удаляет файлы из storage, обнуляет media_path в БД.
        Аватарки (path содержит /avatars/) НЕ трогает.
        """
        while not self._stop.is_set():
            try:
                await asyncio.sleep(60)
                if self._stop.is_set():
                    break
                await self._cleanup_stale_media()
            except asyncio.CancelledError:
                break
            except Exception:
                log.exception("cleanup loop error")

    async def _cleanup_stale_media(self) -> None:
        """Один проход: удаляет медиа в неактивных диалогах."""
        async with SupabaseClient() as sb:
            # Берём все диалоги где есть закешированные медиа
            rows = await sb.select(
                "tg_messages",
                columns="id,session_id,dialog_id,media_path,tg_message_id",
                filters={
                    "media_path": "not.is.null",
                    "deleted": "eq.false",
                },
                limit=500,
            )
        if not rows:
            return
        # Группируем по dialog_id чтобы узнать last_opened_at одним запросом
        dialog_ids = list({r["dialog_id"] for r in rows})
        async with SupabaseClient() as sb:
            views = await sb.select(
                "tg_dialog_views",
                columns="dialog_id,last_opened_at,last_closed_at",
                filters={"dialog_id": f"in.({','.join(dialog_ids)})"},
            )
        view_map = {v["dialog_id"]: v for v in views}
        now = datetime.now(timezone.utc)
        # 5 минут после закрытия (или 5 минут после открытия, если не закрыт явно
        # но heartbeat давно не приходил — last_opened_at старше 5 мин).
        stale_paths: list[str] = []
        stale_msg_ids: list[str] = []
        for r in rows:
            path = r["media_path"]
            # Аватарки не удаляем
            if "/avatars/" in path:
                continue
            v = view_map.get(r["dialog_id"])
            if not v:
                # Если у диалога вообще не было View записи — legacy медиа
                # (после bootstrap'а раньше). Чистим.
                stale_paths.append(path)
                stale_msg_ids.append(r["id"])
                continue
            last_opened = _parse_ts(v.get("last_opened_at"))
            last_closed = _parse_ts(v.get("last_closed_at"))
            # «активный» = открыт меньше 5 мин назад ИЛИ последний heartbeat
            # (last_opened_at обновляется) свежий. Закрытый = last_closed_at
            # был после last_opened_at, и прошло >5 мин.
            ref_time = last_opened
            if last_closed and last_opened and last_closed > last_opened:
                ref_time = last_closed
            if ref_time and (now - ref_time).total_seconds() > 300:
                stale_paths.append(path)
                stale_msg_ids.append(r["id"])
        if not stale_paths:
            return
        log.info("cleanup: removing %d stale media files", len(stale_paths))
        async with SupabaseClient() as sb:
            try:
                await sb.storage_delete("tg-media", stale_paths)
            except Exception:
                log.warning("storage delete batch failed (will retry)", exc_info=True)
            # Обнуляем media_path в БД (батчами по 50 чтобы PostgREST не задохнулся)
            for chunk in _chunks(stale_msg_ids, 50):
                await sb.update(
                    "tg_messages",
                    {"id": f"in.({','.join(chunk)})"},
                    {"media_path": None, "media_size_bytes": None},
                )

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


def _parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        # Postgres возвращает '2026-05-19T00:00:00+00:00' или с микросек
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _chunks(lst: list, n: int):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def _serialize_reactions(msg: Message) -> list[dict] | None:
    """Извлекает реакции из Telethon Message в JSON-сериализуемый формат."""
    reactions = getattr(msg, "reactions", None)
    if not reactions:
        return None
    return _reactions_to_jsonb(reactions)


def _reactions_to_jsonb(reactions: Any) -> list[dict]:
    """Конвертирует MessageReactions Telethon в [{emoji, count, chosen}]."""
    result: list[dict] = []
    results_list = getattr(reactions, "results", None) or []
    for r in results_list:
        reaction = getattr(r, "reaction", None)
        emoji = getattr(reaction, "emoticon", None) if reaction else None
        # Custom emoji (premium) — пропускаем, выглядит как DocumentID
        if not emoji:
            continue
        result.append({
            "emoji": emoji,
            "count": int(getattr(r, "count", 0) or 0),
            "chosen": bool(getattr(r, "chosen_order", None) is not None
                          or getattr(r, "chosen", False)),
        })
    return result


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
