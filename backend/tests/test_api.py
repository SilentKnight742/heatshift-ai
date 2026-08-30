from __future__ import annotations

import asyncio

import httpx

from app.main import app
from app.services.cache import analysis_store


async def request(method: str, path: str, **kwargs) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


def test_health_and_demo_contract() -> None:
    health = asyncio.run(request("GET", "/health"))
    assert health.status_code == 200
    assert health.json()["fortyguard"]["cached_real_response_available"] is True
    assert health.json()["deployment"]["stateless_replay_recovery"] is True

    demo = asyncio.run(request("POST", "/api/demo"))
    assert demo.status_code == 200
    body = demo.json()
    assert body["status"] == "completed"
    assert body["metrics"]["exposure_reduction_percent"] == 78.0
    assert len(body["agent"]["tool_trace"]) == 6


def test_analysis_create_and_cold_instance_recovery() -> None:
    created = asyncio.run(request("POST", "/api/analyses", json={}))
    assert created.status_code == 201
    created_body = created.json()
    assert created_body["status"] == "completed"
    assert created_body["result"]["metrics"]["exposure_reduction_percent"] == 78.0

    analysis_id = created_body["analysis_id"]
    asyncio.run(analysis_store.discard(analysis_id))
    recovered = asyncio.run(request("GET", f"/api/analyses/{analysis_id}"))
    assert recovered.status_code == 200
    assert recovered.json()["analysis_id"] == analysis_id
    assert recovered.json()["status"] == "completed"


def test_analysis_contract_rejects_custom_payload_and_invalid_id() -> None:
    unsupported = asyncio.run(
        request("POST", "/api/analyses", json={"site": {"site_id": "other"}})
    )
    assert unsupported.status_code == 422

    missing = asyncio.run(request("GET", "/api/analyses/not-an-analysis-id"))
    assert missing.status_code == 404


def test_custom_scenario_contract_runs_reference_environment() -> None:
    scenario_response = asyncio.run(request("GET", "/api/demo/scenario"))
    assert scenario_response.status_code == 200
    scenario = scenario_response.json()
    scenario["site"]["name"] = "Custom Phoenix Yard"
    payload = {
        "site": scenario["site"],
        "crews": scenario["crews"],
        "shift": scenario["shift"],
        "environment_source": "phoenix_reference",
    }

    response = asyncio.run(request("POST", "/api/analyze", json=payload))

    assert response.status_code == 200
    body = response.json()
    assert body["site"]["name"] == "Custom Phoenix Yard"
    assert body["metrics"]["exposure_reduction_percent"] == 78.0
    assert len(body["agent"]["tool_trace"]) == 6
    assert asyncio.run(analysis_store.get(body["analysis_id"])) is None


def test_custom_scenario_rejects_unknown_crew() -> None:
    scenario = asyncio.run(request("GET", "/api/demo/scenario")).json()
    scenario["shift"]["tasks"][0]["crew_id"] = "missing"
    payload = {
        "site": scenario["site"],
        "crews": scenario["crews"],
        "shift": scenario["shift"],
        "environment_source": "phoenix_reference",
    }

    response = asyncio.run(request("POST", "/api/analyze", json=payload))

    assert response.status_code == 422


def test_custom_scenario_rejects_invalid_footprint_and_overlapping_work() -> None:
    scenario = asyncio.run(request("GET", "/api/demo/scenario")).json()
    scenario["site"]["site_id"] = "unrelated-site"
    payload = {
        "site": scenario["site"],
        "crews": scenario["crews"],
        "shift": scenario["shift"],
        "environment_source": "phoenix_reference",
    }
    footprint_response = asyncio.run(request("POST", "/api/analyze", json=payload))
    assert footprint_response.status_code == 422

    scenario = asyncio.run(request("GET", "/api/demo/scenario")).json()
    scenario["shift"]["tasks"][2]["scheduled_start"] = "2026-08-28T06:30:00-07:00"
    scenario["shift"]["tasks"][2]["earliest_start"] = "2026-08-28T06:00:00-07:00"
    payload = {
        "site": scenario["site"],
        "crews": scenario["crews"],
        "shift": scenario["shift"],
        "environment_source": "phoenix_reference",
    }
    overlap_response = asyncio.run(request("POST", "/api/analyze", json=payload))
    assert overlap_response.status_code == 422


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
