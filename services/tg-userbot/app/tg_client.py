"""Helpers вокруг Telethon TelegramClient."""
from telethon import TelegramClient
from telethon.sessions import StringSession

from .config import get_settings


def make_client(session_string: str | None = None) -> TelegramClient:
    """Создаёт TelegramClient с StringSession. None = новая, пустая сессия
    (используется в /auth/start до первого send_code_request)."""
    s = get_settings()
    return TelegramClient(
        StringSession(session_string),
        s.TG_API_ID,
        s.TG_API_HASH,
        device_model="FinSalon",
        system_version="Linux Server",
        app_version="1.0.0",
        lang_code="ru",
        system_lang_code="ru",
    )


def dump_session(client: TelegramClient) -> str:
    """Сериализует in-memory session (auth_key, dc_id, etc.) в string."""
    return client.session.save()  # type: ignore[no-any-return]
