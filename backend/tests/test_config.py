from __future__ import annotations

from app.config import _resolve_llm_api_key


def test_llm_key_is_scoped_to_the_selected_provider(monkeypatch) -> None:
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("GROQ_API_KEY", "groq-test-key")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-test-key")
    monkeypatch.setenv("OMNIROUTE_API_KEY", "omniroute-test-key")

    monkeypatch.setenv("LLM_PROVIDER", "groq")
    assert _resolve_llm_api_key() == "groq-test-key"

    monkeypatch.setenv("LLM_PROVIDER", "openai")
    assert _resolve_llm_api_key() == "openai-test-key"

    monkeypatch.setenv("LLM_PROVIDER", "omniroute")
    assert _resolve_llm_api_key() == "omniroute-test-key"


def test_explicit_llm_key_overrides_provider_specific_key(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-test-key")
    monkeypatch.setenv("LLM_API_KEY", "explicit-test-key")

    assert _resolve_llm_api_key() == "explicit-test-key"
