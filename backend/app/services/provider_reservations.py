from __future__ import annotations

import httpx

from ..config import settings
from .supabase_admin import supabase_admin_headers


class ProviderReservationError(RuntimeError):
    pass


class ProviderReservationGuard:
    @property
    def enabled(self) -> bool:
        return bool(settings.supabase_url and settings.supabase_secret_key)

    def _headers(self) -> dict[str, str]:
        if not settings.supabase_secret_key:
            raise ProviderReservationError("Server-side Supabase secret is not configured")
        return supabase_admin_headers(settings.supabase_secret_key)

    async def claim(self, owner_id: str, key: str, request_hash: str, provider_remaining: int) -> str | None:
        if not self.enabled:
            return None
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/claim_heatshift_provider_reservation",
                    headers=self._headers(),
                    json={
                        "p_owner_id": owner_id,
                        "p_reservation_key": key,
                        "p_request_hash": request_hash,
                        "p_credits": settings.fortyguard_site_week_estimate,
                        "p_provider_remaining": provider_remaining,
                        "p_required_reserve": settings.fortyguard_credit_reserve,
                    },
                )
        except httpx.HTTPError as exc:
            raise ProviderReservationError("Global credit reservation is unavailable; no provider work was submitted") from exc
        if response.status_code >= 400:
            raise ProviderReservationError("Global credit reservation failed; no provider work was submitted")
        return str(response.json())

    async def release(self, key: str) -> None:
        if not self.enabled:
            return
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/release_heatshift_provider_reservation",
                    headers=self._headers(),
                    json={"p_reservation_key": key},
                )
        except httpx.HTTPError as exc:
            raise ProviderReservationError("Provider reservation release failed") from exc
        if response.status_code >= 400:
            raise ProviderReservationError("Provider reservation release failed")


provider_reservation_guard = ProviderReservationGuard()
