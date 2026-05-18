"""Async-обёртка над Supabase REST (PostgREST) с service_role ключом.

Используется bridge'ом для bypass RLS (мы — системный процесс, имеем право
писать/читать любые tg_* записи). Юзерские права проверяются на уровне FastAPI
endpoint'ов через JWT.
"""
from typing import Any, Optional
import httpx

from .config import get_settings


class SupabaseError(Exception):
    pass


class SupabaseClient:
    """Минимальный PostgREST-клиент: select/insert/update/upsert/delete +
    storage upload. Использует service_role key — обходит RLS."""

    def __init__(self) -> None:
        s = get_settings()
        self.base = s.SUPABASE_URL.rstrip("/")
        self.headers = {
            "apikey": s.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {s.SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "SupabaseClient":
        self._client = httpx.AsyncClient(timeout=30.0, headers=self.headers)
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError("Use SupabaseClient as async context manager")
        return self._client

    # --- PostgREST ---

    async def select(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: Optional[dict[str, str]] = None,
        order: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> list[dict]:
        params: dict[str, str] = {"select": columns}
        if filters:
            params.update(filters)
        if order:
            params["order"] = order
        if limit:
            params["limit"] = str(limit)
        r = await self.client.get(f"{self.base}/rest/v1/{table}", params=params)
        if r.status_code >= 400:
            raise SupabaseError(f"select {table} failed: {r.status_code} {r.text}")
        return r.json()

    async def insert(self, table: str, row: dict | list[dict]) -> list[dict]:
        r = await self.client.post(f"{self.base}/rest/v1/{table}", json=row)
        if r.status_code >= 400:
            raise SupabaseError(f"insert {table} failed: {r.status_code} {r.text}")
        return r.json()

    async def upsert(
        self,
        table: str,
        row: dict | list[dict],
        *,
        on_conflict: str,
    ) -> list[dict]:
        headers = {"Prefer": "resolution=merge-duplicates,return=representation"}
        r = await self.client.post(
            f"{self.base}/rest/v1/{table}",
            params={"on_conflict": on_conflict},
            json=row,
            headers=headers,
        )
        if r.status_code >= 400:
            raise SupabaseError(f"upsert {table} failed: {r.status_code} {r.text}")
        return r.json()

    async def update(self, table: str, filters: dict[str, str], patch: dict) -> list[dict]:
        r = await self.client.patch(
            f"{self.base}/rest/v1/{table}",
            params=filters,
            json=patch,
        )
        if r.status_code >= 400:
            raise SupabaseError(f"update {table} failed: {r.status_code} {r.text}")
        return r.json()

    async def delete(self, table: str, filters: dict[str, str]) -> None:
        r = await self.client.delete(f"{self.base}/rest/v1/{table}", params=filters)
        if r.status_code >= 400:
            raise SupabaseError(f"delete {table} failed: {r.status_code} {r.text}")

    # --- Storage ---

    async def storage_upload(
        self,
        bucket: str,
        path: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        url = f"{self.base}/storage/v1/object/{bucket}/{path}"
        headers = {
            "apikey": self.headers["apikey"],
            "Authorization": self.headers["Authorization"],
            "Content-Type": content_type,
            "x-upsert": "true",
        }
        r = await self.client.post(url, content=content, headers=headers)
        if r.status_code >= 400:
            raise SupabaseError(f"storage upload {bucket}/{path} failed: {r.status_code} {r.text}")
        return path
