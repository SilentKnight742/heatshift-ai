from __future__ import annotations

import asyncio

import httpx

from main import app as vercel_app


async def request(method: str, path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=vercel_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://vercel") as client:
        return await client.request(method, path)


def test_vercel_entrypoint_serves_health_and_demo() -> None:
    health = asyncio.run(request("GET", "/health"))
    assert health.status_code == 200

    demo = asyncio.run(request("POST", "/api/demo"))
    assert demo.status_code == 200
    assert demo.json()["metrics"]["exposure_reduction_percent"] == 78.0
