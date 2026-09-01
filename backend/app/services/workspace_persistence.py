from __future__ import annotations

from typing import Any

import httpx
from fastapi.encoders import jsonable_encoder

from ..config import settings


class WorkspacePersistenceError(RuntimeError):
    pass


class SupabaseWorkspacePersistence:
    """Small RLS-scoped persistence adapter for the domain workspace snapshot.

    Curated environmental rows are deliberately not duplicated into this snapshot.
    They continue to come from the immutable repository cache; only private operational
    overlays, private live sites, plans and quota state are persisted here.
    """

    @property
    def enabled(self) -> bool:
        return bool(settings.supabase_url and settings.supabase_publishable_key)

    def _headers(self, token: str) -> dict[str, str]:
        if not settings.supabase_publishable_key:
            raise WorkspacePersistenceError("Supabase publishable key is not configured")
        return {
            "apikey": settings.supabase_publishable_key,
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
        }

    async def load(self, owner_id: str, token: str) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        url = f"{settings.supabase_url.rstrip('/')}/rest/v1/workspaces"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(
                    url,
                    params={"owner_id": f"eq.{owner_id}", "select": "domain_snapshot"},
                    headers=self._headers(token),
                )
        except httpx.HTTPError as exc:
            raise WorkspacePersistenceError("Workspace storage is unavailable") from exc
        if response.status_code >= 400:
            raise WorkspacePersistenceError(f"Workspace storage rejected the read ({response.status_code})")
        rows = response.json()
        return rows[0].get("domain_snapshot") if rows else None

    async def save(self, owner_id: str, token: str, snapshot: dict[str, Any]) -> None:
        if not self.enabled:
            return
        url = f"{settings.supabase_url.rstrip('/')}/rest/v1/workspaces"
        headers = {
            **self._headers(token),
            "prefer": "resolution=merge-duplicates,return=minimal",
        }
        payload = jsonable_encoder({"owner_id": owner_id, "domain_snapshot": snapshot})
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    url, params={"on_conflict": "owner_id"}, headers=headers, json=payload
                )
        except httpx.HTTPError as exc:
            raise WorkspacePersistenceError("Workspace changes could not be saved") from exc
        if response.status_code >= 400:
            raise WorkspacePersistenceError(f"Workspace storage rejected the change ({response.status_code})")


workspace_persistence = SupabaseWorkspacePersistence()
