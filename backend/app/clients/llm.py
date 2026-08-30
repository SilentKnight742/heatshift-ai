from __future__ import annotations

import httpx

from ..config import Settings, settings


class LLMUnavailable(RuntimeError):
    pass


class ResponsesClient:
    """Minimal client for a Responses-compatible provider."""

    def __init__(self, config: Settings = settings):
        self.config = config

    @property
    def available(self) -> bool:
        return bool(self.config.llm_api_key and self.config.llm_model)

    async def create(
        self,
        input_items: list[dict],
        tools: list[dict],
        instructions: str,
        tool_choice: str | None = None,
    ) -> dict:
        if not self.available:
            raise LLMUnavailable("LLM_MODEL and LLM_API_KEY are not both configured")
        headers = {
            "authorization": f"Bearer {self.config.llm_api_key}",
            "content-type": "application/json",
        }
        payload = {
            "model": self.config.llm_model,
            "instructions": instructions,
            "input": input_items,
            "max_output_tokens": self.config.llm_max_output_tokens,
        }
        if self.config.llm_reasoning_effort:
            payload["reasoning"] = {"effort": self.config.llm_reasoning_effort}
        if tools:
            payload["tools"] = tools
            # Every HeatShift tool is a read-only view over the completed,
            # deterministic analysis, so a capable provider may batch them.
            payload["parallel_tool_calls"] = True
            if tool_choice:
                payload["tool_choice"] = tool_choice
        async with httpx.AsyncClient(timeout=45) as client:
            try:
                response = await client.post(
                    f"{self.config.llm_base_url.rstrip('/')}/responses",
                    headers=headers,
                    json=payload,
                )
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as exc:
                detail = exc.response.text.strip().replace("\n", " ")[:500]
                raise LLMUnavailable(
                    f"Responses provider returned HTTP {exc.response.status_code}: {detail}"
                ) from exc
            except (httpx.HTTPError, ValueError) as exc:
                raise LLMUnavailable(f"Responses provider unavailable: {exc}") from exc
