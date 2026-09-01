from __future__ import annotations

from fastapi import APIRouter

from ..clients.fortyguard import FortyGuardClient
from ..clients.llm import ResponsesClient
from ..config import settings
from ..services.validation_service import DATA_PATH, PROVENANCE_PATH


router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    fortyguard = FortyGuardClient()
    llm = ResponsesClient()
    return {
        "status": "ok",
        "backend": "ready",
        "version": "1.0.0",
        "deployment": {
            "profile": "zero-cost-demo",
            "stateless_replay_recovery": True,
            "durable_user_storage": bool(settings.supabase_url and settings.supabase_publishable_key),
            "anonymous_workspace_auth": "supabase" if settings.supabase_jwks_url else "local-test-adapter",
        },
        "fortyguard": {
            "configured": fortyguard.configured,
            "mode": settings.fortyguard_mode,
            "cached_real_response_available": (
                (fortyguard.cache_dir / "fortyguard_demo_response.json").exists()
                and (fortyguard.cache_dir / "fortyguard_environment_response.json").exists()
            ),
        },
        "llm": {
            "configured": llm.available,
            "provider": settings.llm_provider,
            "core_analysis_requires_llm": False,
        },
        "empirical_validation": {
            "available": DATA_PATH.exists() and PROVENANCE_PATH.exists(),
            "source": "HEAT-SHIELD controlled human-exposure trials",
            "requires_external_api": False,
        },
    }
