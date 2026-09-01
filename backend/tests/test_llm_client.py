from __future__ import annotations

import pytest

from app.clients.llm import ResponsesClient
from app.config import Settings


class _Response:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"output_text": "Grounded answer"}


class _AsyncClient:
    last_payload: dict | None = None

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args) -> None:
        return None

    async def post(self, url: str, *, headers: dict, json: dict) -> _Response:
        self.__class__.last_payload = json
        return _Response()


@pytest.mark.anyio
async def test_qwen_non_thinking_effort_reaches_responses_payload(monkeypatch) -> None:
    monkeypatch.setattr("app.clients.llm.httpx.AsyncClient", _AsyncClient)
    client = ResponsesClient(Settings(llm_api_key="test-key", llm_reasoning_effort="none"))

    result = await client.create(
        [{"role": "user", "content": "Explain the result."}],
        [],
        "Use only authoritative values.",
    )

    assert result["output_text"] == "Grounded answer"
    assert _AsyncClient.last_payload is not None
    assert _AsyncClient.last_payload["reasoning"] == {"effort": "none"}
