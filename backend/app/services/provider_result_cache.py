from __future__ import annotations

import copy
from typing import Any

import httpx
from fastapi.encoders import jsonable_encoder

from ..config import settings
from .supabase_admin import supabase_admin_headers


class ProviderResultCacheError(RuntimeError):
    pass


class ProviderResultCache:
    """Server-only exact-request cache with a local development adapter."""

    def __init__(self) -> None:
        self._memory: dict[str, dict[str, Any]] = {}

    @property
    def durable(self) -> bool:
        return bool(settings.supabase_url and settings.supabase_secret_key)

    def _headers(self) -> dict[str, str]:
        if not settings.supabase_secret_key:
            raise ProviderResultCacheError("Server-side Supabase secret is not configured")
        return supabase_admin_headers(settings.supabase_secret_key)

    async def get(self, request_hash: str) -> dict[str, Any] | None:
        if request_hash in self._memory:
            return copy.deepcopy(self._memory[request_hash])
        if not self.durable:
            return None
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(
                    f"{settings.supabase_url.rstrip('/')}/rest/v1/provider_request_cache",
                    params={"request_hash": f"eq.{request_hash}", "select": "payload"},
                    headers=self._headers(),
                )
        except httpx.HTTPError as exc:
            raise ProviderResultCacheError("Provider result cache is unavailable; no paid work was submitted") from exc
        if response.status_code >= 400:
            raise ProviderResultCacheError("Provider result cache rejected the lookup; no paid work was submitted")
        rows = response.json()
        if not rows:
            return None
        self._memory[request_hash] = rows[0]["payload"]
        return copy.deepcopy(rows[0]["payload"])

    async def put(self, request_hash: str, payload: dict[str, Any]) -> None:
        encoded = jsonable_encoder(payload)
        self._memory[request_hash] = copy.deepcopy(encoded)
        if not self.durable:
            return
        headers = {**self._headers(), "prefer": "resolution=merge-duplicates,return=minimal"}
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    f"{settings.supabase_url.rstrip('/')}/rest/v1/provider_request_cache",
                    params={"on_conflict": "request_hash"},
                    headers=headers,
                    json={"request_hash": request_hash, "payload": encoded},
                )
        except httpx.HTTPError as exc:
            raise ProviderResultCacheError("Provider result cache could not save the completed site-week") from exc
        if response.status_code >= 400:
            raise ProviderResultCacheError("Provider result cache rejected the completed site-week")


provider_result_cache = ProviderResultCache()
