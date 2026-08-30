from __future__ import annotations

import asyncio

import httpx

from app.main import app


async def request(method: str, path: str, **kwargs) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


def test_health_and_demo_contract() -> None:
    health = asyncio.run(request("GET", "/health"))
    assert health.status_code == 200
    assert health.json()["fortyguard"]["cached_real_response_available"] is True

    demo = asyncio.run(request("POST", "/api/demo"))
    assert demo.status_code == 200
    body = demo.json()
    assert body["status"] == "completed"
    assert body["metrics"]["exposure_reduction_percent"] == 78.0
    assert len(body["agent"]["tool_trace"]) == 6


def test_local_loopback_cors_preflight() -> None:
    response = asyncio.run(
        request(
            "OPTIONS",
            "/api/demo",
            headers={
                "origin": "http://127.0.0.1:3000",
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
            },
        )
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"

