from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]


def _resolve_llm_api_key() -> str | None:
    """Select only credentials that belong to the configured provider."""

    explicit = os.getenv("LLM_API_KEY")
    if explicit:
        return explicit
    provider = os.getenv("LLM_PROVIDER", "groq").lower()
    if provider == "groq":
        return os.getenv("GROQ_API_KEY")
    if provider == "openai":
        return os.getenv("OPENAI_API_KEY")
    if provider == "omniroute":
        return os.getenv("OMNIROUTE_API_KEY")
    return None


@dataclass(frozen=True)
class Settings:
    fortyguard_api_key: str | None = os.getenv("FORTYGUARD_API_KEY")
    fortyguard_base_url: str = os.getenv("FORTYGUARD_BASE_URL", "https://api.fortyguard.com")
    fortyguard_mode: str = os.getenv("FORTYGUARD_MODE", "cached").lower()
    llm_provider: str = os.getenv("LLM_PROVIDER", "groq")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
    llm_api_key: str | None = _resolve_llm_api_key()
    llm_model: str | None = os.getenv("LLM_MODEL", "qwen/qwen3.6-27b")
    llm_reasoning_effort: str = os.getenv("LLM_REASONING_EFFORT", "")
    llm_max_output_tokens: int = int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "1536"))
    supabase_url: str | None = os.getenv("SUPABASE_URL")
    supabase_publishable_key: str | None = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    supabase_secret_key: str | None = os.getenv("SUPABASE_SECRET_KEY")
    supabase_jwks_url: str | None = os.getenv("SUPABASE_JWKS_URL")
    turnstile_secret_key: str | None = os.getenv("TURNSTILE_SECRET_KEY")
    turnstile_expected_hostnames: tuple[str, ...] = tuple(
        host.strip()
        for host in os.getenv(
            "TURNSTILE_EXPECTED_HOSTNAMES",
            "localhost,127.0.0.1,heatshift-ai-zeta.vercel.app",
        ).split(",")
        if host.strip()
    )
    fortyguard_credit_reserve: int = int(os.getenv("FORTYGUARD_CREDIT_RESERVE", "200000"))
    fortyguard_site_week_estimate: int = int(os.getenv("FORTYGUARD_SITE_WEEK_ESTIMATE", "64240"))
    # The header-based adapter exists only so the complete product can be tested
    # without cloud credentials.  A hosted Vercel runtime must fail closed unless
    # Supabase JWT verification has explicitly been configured.
    weekly_local_auth: bool = os.getenv(
        "HEATSHIFT_LOCAL_AUTH", "false" if os.getenv("VERCEL") else "true"
    ).lower() == "true"
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if origin.strip()
    )


settings = Settings()
