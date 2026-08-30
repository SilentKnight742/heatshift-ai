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
    llm_model: str | None = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if origin.strip()
    )


settings = Settings()
