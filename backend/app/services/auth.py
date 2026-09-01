from __future__ import annotations

from dataclasses import dataclass

import httpx
from fastapi import Header, HTTPException

from ..config import settings


@dataclass(frozen=True)
class WorkspacePrincipal:
    user_id: str
    access_token: str | None
    local: bool


async def require_workspace(
    authorization: str | None = Header(default=None),
    x_heatshift_workspace: str | None = Header(default=None),
) -> WorkspacePrincipal:
    """Verify Supabase anonymous users; allow an explicit local adapter in dev/CI."""
    if settings.supabase_url:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="A Supabase anonymous bearer token is required")
        token = authorization.removeprefix("Bearer ").strip()
        api_key = settings.supabase_publishable_key or settings.supabase_secret_key
        if not api_key:
            raise HTTPException(status_code=503, detail="Supabase authentication is not fully configured")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(
                    f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
                    headers={"apikey": api_key, "authorization": f"Bearer {token}"},
                )
            if response.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid or expired anonymous session")
            user_id = str(response.json().get("id") or "")
            if not user_id:
                raise HTTPException(status_code=401, detail="Anonymous session has no user ID")
            return WorkspacePrincipal(user_id=user_id, access_token=token, local=False)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=503, detail="Supabase identity could not be verified") from exc

    if not settings.weekly_local_auth:
        raise HTTPException(status_code=503, detail="Anonymous authentication is not configured")
    workspace = (x_heatshift_workspace or "local-demo").strip()
    if not workspace or len(workspace) > 100:
        raise HTTPException(status_code=400, detail="Invalid local workspace ID")
    return WorkspacePrincipal(user_id=workspace, access_token=None, local=True)

