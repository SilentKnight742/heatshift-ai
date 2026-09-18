from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from time import monotonic
from typing import Any

from ..clients.fortyguard import FortyGuardClient, FortyGuardError
from .provisioning import _remaining_credits


class ProviderStatusService:
    """A cached, read-only FortyGuard availability and credit check."""

    def __init__(self, ttl_seconds: int = 300) -> None:
        self.ttl_seconds = ttl_seconds
        self._cached: dict[str, Any] | None = None
        self._cached_at = 0.0
        self._lock = asyncio.Lock()

    def clear(self) -> None:
        self._cached = None
        self._cached_at = 0.0

    async def check(
        self,
        *,
        force: bool = False,
        client: FortyGuardClient | None = None,
    ) -> dict[str, Any]:
        if not force and self._cached and monotonic() - self._cached_at < self.ttl_seconds:
            return dict(self._cached)

        async with self._lock:
            if not force and self._cached and monotonic() - self._cached_at < self.ttl_seconds:
                return dict(self._cached)

            provider = client or FortyGuardClient()
            checked_at = datetime.now(timezone.utc).isoformat()
            if not provider.configured:
                result = {
                    "state": "not_configured",
                    "live_available": False,
                    "fallback_active": True,
                    "credits_remaining": None,
                    "checked_at": checked_at,
                    "message": "FortyGuard is not configured. Cached and simulated evidence remain available.",
                }
            else:
                try:
                    usage = await provider.get_credit_usage()
                    remaining = _remaining_credits(usage)
                    if remaining is not None and remaining <= 0:
                        result = {
                            "state": "credits_exhausted",
                            "live_available": False,
                            "fallback_active": True,
                            "credits_remaining": remaining,
                            "checked_at": checked_at,
                            "message": "No FortyGuard credits are available. Cached and simulated evidence remain available.",
                        }
                    else:
                        result = {
                            "state": "available",
                            "live_available": True,
                            "fallback_active": False,
                            "credits_remaining": remaining,
                            "checked_at": checked_at,
                            "message": "FortyGuard responded to the read-only usage check.",
                        }
                except FortyGuardError:
                    result = {
                        "state": "provider_unavailable",
                        "live_available": False,
                        "fallback_active": True,
                        "credits_remaining": None,
                        "checked_at": checked_at,
                        "message": "A secure connection to FortyGuard could not be established. Cached and simulated evidence remain available.",
                    }

            self._cached = result
            self._cached_at = monotonic()
            return dict(result)


provider_status_service = ProviderStatusService()
