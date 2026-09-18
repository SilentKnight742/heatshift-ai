from __future__ import annotations

import uuid
from datetime import date

import httpx
import pytest

from app.main import app
from app.services.daily_analysis import HIGH_RISK_THRESHOLD, site_thermal_burden, validate_schedule
from app.services.daily_store import daily_store


@pytest.fixture
async def client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as value:
        yield value


def headers() -> dict[str, str]:
    return {"x-heatshift-workspace": f"daily-test-{uuid.uuid4()}"}


@pytest.mark.anyio
async def test_state_catalog_keeps_all_states_and_dc(client: httpx.AsyncClient):
    response = await client.get("/api/daily/states")
    assert response.status_code == 200
    values = response.json()
    assert len(values) == 51
    assert {"code": "DC", "name": "Washington, DC"} in values


@pytest.mark.anyio
async def test_three_default_sites_are_preanalyzed_large_daily_operations(client: httpx.AsyncClient):
    response = await client.get("/api/daily/sites", headers=headers())
    assert response.status_code == 200
    sites = response.json()
    assert {item["site_id"] for item in sites} == {
        "desertline-phoenix", "gulfgate-houston", "sungrid-miami"
    }
    assert all(item["workflow_stage"] == "analyzed" for item in sites)
    assert all(item["evidence_kind"] == "fortyguard_cached" for item in sites)
    for site in sites:
        workspace = (await client.get(f"/api/daily/sites/{site['site_id']}", headers=headers())).json()
        assert len(workspace["evidence"]["conditions"]) == 24
        assert workspace["evidence"]["heat_cells"]
        assert len(workspace["crews"]) == 8
        assert len(workspace["jobs"]) == 40
        assert workspace["analysis"]["metrics"]["constraint_valid"] is True


@pytest.mark.anyio
async def test_custom_site_flow_is_isolated_and_requires_generation(client: httpx.AsyncClient, monkeypatch):
    owner = headers()
    outsider = headers()
    payload = {
        "name": "Mesa field operation",
        "state_code": "AZ",
        "site_type": "utility maintenance",
        "operation_date": "2026-08-20",
        "geometry": {"type": "coordinates", "longitude": -112.05, "latitude": 33.45, "radius_m": 500},
    }
    created = await client.post("/api/daily/sites", headers=owner, json=payload)
    assert created.status_code == 201
    site_id = created.json()["site_id"]
    assert created.json()["workflow_stage"] == "site_created"
    assert (await client.get(f"/api/daily/sites/{site_id}", headers=outsider)).status_code == 404
    blocked = await client.post(f"/api/daily/sites/{site_id}/analysis", headers=owner)
    assert blocked.status_code == 409
    assert "generate" in blocked.json()["detail"]

    async def fallback_labels(_site):
        from app.services.daily_simulator import FALLBACK_ACTIVITIES
        return FALLBACK_ACTIVITIES, "deterministic_stochastic"

    monkeypatch.setattr("app.services.daily_simulator._activity_labels", fallback_labels)
    generated = await client.post(
        f"/api/daily/sites/{site_id}/simulation",
        headers=owner,
        json={"seed": 90210, "crew_count": 6, "jobs_per_crew": 4},
    )
    assert generated.status_code == 200
    body = generated.json()
    assert body["site"]["workflow_stage"] == "simulation_ready"
    assert body["site"]["evidence_kind"] == "simulated_local"
    assert len(body["crews"]) == 6
    assert len(body["jobs"]) == 24
    assert body["simulation"]["worker_count"] >= 42
    assert body["analysis"] is None

    analyzed = await client.post(f"/api/daily/sites/{site_id}/analysis", headers=owner)
    assert analyzed.status_code == 200
    result = analyzed.json()
    assert result["operation_date"] == "2026-08-20"
    assert result["metrics"]["constraint_valid"] is True
    assert result["metrics"]["productive_task_time_retained_percent"] == 100


@pytest.mark.anyio
async def test_same_seed_reproduces_the_operation(client: httpx.AsyncClient, monkeypatch):
    owner = headers()
    created = (await client.post("/api/daily/sites", headers=owner, json={
        "name": "Determinism yard", "state_code": "TX", "site_type": "container yard",
        "operation_date": "2024-07-17",
        "geometry": {"type": "circle", "longitude": -95.25, "latitude": 29.74, "radius_m": 500},
    })).json()

    async def fallback_labels(_site):
        from app.services.daily_simulator import FALLBACK_ACTIVITIES
        return FALLBACK_ACTIVITIES, "deterministic_stochastic"

    monkeypatch.setattr("app.services.daily_simulator._activity_labels", fallback_labels)
    request = {"seed": 77, "crew_count": 8, "jobs_per_crew": 5}
    first = (await client.post(f"/api/daily/sites/{created['site_id']}/simulation", headers=owner, json=request)).json()
    second = (await client.post(f"/api/daily/sites/{created['site_id']}/simulation", headers=owner, json=request)).json()
    signature = lambda body: [
        (job["name"], job["duration_minutes"], job["workload"], job["original_start"], job["movable"])
        for job in body["jobs"]
    ]
    assert signature(first) == signature(second)
    assert first["simulation"] == second["simulation"]


@pytest.mark.anyio
async def test_daily_optimizer_preserves_hard_constraints_and_metrics_are_traceable(client: httpx.AsyncClient):
    owner = headers()
    workspace = (await client.get("/api/daily/sites/desertline-phoenix", headers=owner)).json()
    analysis = workspace["analysis"]
    metrics = analysis["metrics"]
    assert metrics["proposed_exposure_worker_minutes"] <= metrics["original_exposure_worker_minutes"]
    assert metrics["residual_alerts"] == sum(
        entry["screening_score"] >= HIGH_RISK_THRESHOLD for entry in analysis["heatshift"]
    )
    assert metrics["tasks_rescheduled"] == sum(
        left["start"] != right["start"]
        for left, right in zip(
            sorted(analysis["original"], key=lambda item: item["job_id"]),
            sorted(analysis["heatshift"], key=lambda item: item["job_id"]),
            strict=True,
        )
    )
    record = await daily_store.record(owner["x-heatshift-workspace"], "desertline-phoenix")
    assert validate_schedule(record.analysis.heatshift, record.jobs) == []
    assert site_thermal_burden(record.evidence) == metrics["site_thermal_burden_degree_hours"]
    assert "formula" in analysis["explanations"]["crew_load"]
    assert {
        "exposure", "risk_reduction", "high_risk_time", "thermal_burden", "crew_load",
        "disruption", "tasks_rescheduled", "fixed_preserved", "residual_alerts",
        "retained_work", "constraint_validity",
    } == set(analysis["explanations"])


@pytest.mark.anyio
async def test_invalid_geometry_and_simulation_bounds_fail_cleanly(client: httpx.AsyncClient):
    owner = headers()
    invalid_site = await client.post("/api/daily/sites", headers=owner, json={
        "name": "Ocean corner", "state_code": "NY", "site_type": "yard",
        "operation_date": date.today().isoformat(),
        "geometry": {"type": "circle", "longitude": -71.90, "latitude": 40.52, "radius_m": 100},
    })
    assert invalid_site.status_code == 422
    bounded = await client.post(
        "/api/daily/sites/desertline-phoenix/simulation",
        headers=owner,
        json={"seed": 1, "crew_count": 2, "jobs_per_crew": 10},
    )
    assert bounded.status_code == 422


@pytest.mark.anyio
async def test_curated_sites_cannot_be_deleted(client: httpx.AsyncClient):
    response = await client.delete("/api/daily/sites/desertline-phoenix", headers=headers())
    assert response.status_code == 409
    assert "cannot be deleted" in response.json()["detail"]
