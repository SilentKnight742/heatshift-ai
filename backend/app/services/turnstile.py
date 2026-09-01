from __future__ import annotations

import httpx

from ..config import settings


class TurnstileError(RuntimeError):
    pass


class TurnstileVerifier:
    def __init__(self) -> None:
        self._used_tokens: set[str] = set()

    async def verify(self, token: str, remote_ip: str | None = None) -> None:
        if token in self._used_tokens:
            raise TurnstileError("Turnstile token has already been used")
        if not settings.turnstile_secret_key:
            if settings.weekly_local_auth and token.startswith("local-turnstile-test"):
                self._used_tokens.add(token)
                return
            raise TurnstileError("Turnstile is not configured")
        payload = {"secret": settings.turnstile_secret_key, "response": token}
        if remote_ip:
            payload["remoteip"] = remote_ip
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data=payload,
            )
        if response.status_code != 200:
            raise TurnstileError("Turnstile validation service failed")
        result = response.json()
        if not result.get("success"):
            raise TurnstileError("Turnstile validation failed")
        if result.get("action") != "provision-site-week":
            raise TurnstileError("Turnstile action did not match")
        hostname = result.get("hostname")
        if hostname and hostname not in settings.turnstile_expected_hostnames:
            raise TurnstileError("Turnstile hostname did not match")
        self._used_tokens.add(token)


turnstile_verifier = TurnstileVerifier()
