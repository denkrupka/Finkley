"""Application settings loaded from environment (или из .env при локальной разработке)."""
from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # --- Telegram MTProto API ---
    TG_API_ID: int
    TG_API_HASH: str

    # --- Supabase ---
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str           # для верификации Bearer JWT через /auth/v1/user
    SUPABASE_SERVICE_ROLE_KEY: str   # для записи в tg_* таблицы (bypass RLS)

    # --- App-level encryption (32 байта base64) ---
    # Отдельный от SECRETS_ENCRYPTION_KEY (wFirma) ключ для tg-сессий —
    # domain separation: компрометация одного модуля не утечёт сессии другого.
    TG_SECRETS_KEY: str

    # --- Service ---
    ENV: str = "prod"
    PUBLIC_URL: str = "https://userbot.finkley.app"
    CORS_ORIGINS: str = "https://finkley.app"

    @property
    def is_dev(self) -> bool:
        return self.ENV.lower() == "dev"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
