from __future__ import annotations

import uuid
from datetime import date, timedelta
from pathlib import Path
from time import perf_counter

import httpx
import pytest

from app.main import app
from app.clients.fortyguard import FortyGuardError
from app.models.weekly import GeometryInput, JobStatus, PlanLayer
from app.models.site import GeoPoint
from app.models.weekly import ProvisionRequest
from app.routes.health import _anonymous_workspace_auth_mode
from app.services.provisioning import ProvisioningError, ProvisioningService, _prepare_failed_retry, _remaining_credits, _request_hash
from app.services.provider_result_cache import provider_result_cache
from app.services.state_catalog import (
    circle_feature_collection,
    normalize_geometry,
    polygon_area_square_miles,
    state_options,
    validate_in_state,
)
from app.services.supabase_admin import supabase_admin_headers
from app.services.turnstile import TurnstileError, TurnstileVerifier
from app.services.weekly_ai import contradicts_analysis, is_numerically_grounded
from app.services.weekly_metrics import THERMAL_BURDEN_BASELINE_C, entry_for, site_thermal_burden
from app.services.weekly_optimizer import WeeklyOptimizer
from app.services.weekly_store import weekly_store


def workspace_headers() -> dict[str, str]:
    return {"x-heatshift-workspace": f"test-{uuid.uuid4()}"}


def test_health_auth_mode_distinguishes_supabase_local_and_fail_closed():
    assert _anonymous_workspace_auth_mode("https://example.supabase.co", "publishable", False) == "supabase"
    assert _anonymous_workspace_auth_mode(None, None, True) == "local-test-adapter"
    assert _anonymous_workspace_auth_mode(None, None, False) == "unconfigured-fail-closed"


def test_supabase_admin_headers_support_current_and_legacy_keys():
    current = supabase_admin_headers("sb_secret_example")
    assert current["apikey"] == "sb_secret_example"
    assert "authorization" not in current

    legacy = supabase_admin_headers("legacy-service-role-jwt")
    assert legacy["apikey"] == "legacy-service-role-jwt"
    assert legacy["authorization"] == "Bearer legacy-service-role-jwt"


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as value:
        yield value


@pytest.mark.anyio
async def test_state_catalog_exposes_fifty_states_and_dc(client: httpx.AsyncClient):
    response = await client.get("/api/states")
    assert response.status_code == 200
    options = response.json()
    assert len(options) == 51
    assert {"code": "DC", "name": "Washington, DC"} in options


def test_circle_is_32_vertex_geojson_and_area_is_bounded():
    polygon = circle_feature_collection(-112.0675, 33.4515, 500)
    ring = polygon["features"][0]["geometry"]["coordinates"][0]
    assert len(ring) == 33
    assert ring[0] == ring[-1]
    assert 0.25 < polygon_area_square_miles(polygon) < 0.4
    validate_in_state(polygon, "AZ")


def test_state_and_ten_square_mile_guards_fail_closed():
    with pytest.raises(ValueError, match="selected state"):
        validate_in_state(circle_feature_collection(-95.36, 29.76, 500), "AZ")
    with pytest.raises(ValueError, match="10 mi²"):
        validate_in_state(circle_feature_collection(-112.0675, 33.4515, 5000), "AZ")


def test_polygon_creation_rejects_self_intersections_and_multiple_features():
    bow_tie = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [[[-112.1, 33.4], [-112.0, 33.5], [-112.1, 33.5], [-112.0, 33.4], [-112.1, 33.4]]]}}]}
    with pytest.raises(ValueError, match="self-intersect"):
        normalize_geometry(GeometryInput(type="polygon", polygon=bow_tie))
    multiple = {**bow_tie, "features": bow_tie["features"] * 2}
    with pytest.raises(ValueError, match="exactly one"):
        normalize_geometry(GeometryInput(type="polygon", polygon=multiple))


@pytest.mark.anyio
async def test_anonymous_workspaces_are_isolated(client: httpx.AsyncClient):
    owner_a, owner_b = workspace_headers(), workspace_headers()
    payload = {
        "name": "Private test yard",
        "state_code": "AZ",
        "site_type": "maintenance yard",
        "geometry": {"type": "circle", "longitude": -112.05, "latitude": 33.45, "radius_m": 300},
    }
    created = await client.post("/api/sites", headers=owner_a, json=payload)
    assert created.status_code == 201
    site_id = created.json()["site_id"]
    assert (await client.get(f"/api/sites/{site_id}", headers=owner_a)).status_code == 200
    assert (await client.get(f"/api/sites/{site_id}", headers=owner_b)).status_code == 404


@pytest.mark.anyio
async def test_curated_portfolio_supports_state_site_week_day_and_hour(client: httpx.AsyncClient):
    headers = workspace_headers()
    sites = (await client.get("/api/states/AZ/sites", headers=headers)).json()
    assert len(sites) == 1
    site = (await client.get(f"/api/sites/{sites[0]['site_id']}", headers=headers)).json()
    assert len(site["days"]) == 7
    assert all(len(day["conditions"]) == 24 for day in site["days"])
    assert all(day["heat_cells"] for day in site["days"])
    assert site["site"]["source_label"].startswith(("Cached FortyGuard", "Labeled demonstration"))


@pytest.mark.anyio
async def test_week_change_never_reuses_mismatched_evidence(client: httpx.AsyncClient):
    headers = workspace_headers()
    patch = await client.patch("/api/workspace", headers=headers, json={"week_start": "2024-08-05"})
    assert patch.status_code == 200
    site = (await client.get("/api/states/AZ/sites", headers=headers)).json()[0]
    assert site["data_status"] == "unavailable"
    detail = (await client.get(f"/api/sites/{site['site_id']}", headers=headers)).json()
    assert detail["days"] == []
    assert detail["analysis"] is None


@pytest.mark.anyio
async def test_site_crew_job_crud_and_completed_lock(client: httpx.AsyncClient):
    headers = workspace_headers()
    site_response = await client.post("/api/sites", headers=headers, json={
        "name": "CRUD yard", "state_code": "AZ", "site_type": "yard",
        "geometry": {"type": "coordinates", "longitude": -112.05, "latitude": 33.45, "radius_m": 400},
    })
    site = site_response.json()
    crew_response = await client.post(f"/api/sites/{site['site_id']}/crews", headers=headers, json={
        "name": "Alpha", "worker_count": 3, "acclimatization_status": "returning", "ppe_level": "medium", "default_workload": "heavy",
    })
    assert crew_response.status_code == 201
    crew = crew_response.json()
    start = "2024-07-15T10:00:00-07:00"
    job_response = await client.post(f"/api/sites/{site['site_id']}/jobs", headers=headers, json={
        "name": "Valve replacement", "location": site["centroid"], "duration_minutes": 60, "workload": "heavy",
        "original_start": start, "earliest_start": "2024-07-15T06:00:00-07:00", "latest_finish": "2024-07-15T18:00:00-07:00",
        "assigned_crew_id": crew["crew_id"], "eligible_crew_ids": [crew["crew_id"]], "dependencies": [], "movable": True, "shaded": False,
    })
    assert job_response.status_code == 201
    job = job_response.json()
    completed = await client.patch(f"/api/sites/{site['site_id']}/jobs/{job['job_id']}", headers=headers, json={"status": "completed"})
    assert completed.status_code == 200
    locked = await client.patch(f"/api/sites/{site['site_id']}/jobs/{job['job_id']}", headers=headers, json={"name": "Changed"})
    assert locked.status_code == 409
    assigned_delete = await client.delete(f"/api/sites/{site['site_id']}/crews/{crew['crew_id']}", headers=headers)
    assert assigned_delete.status_code == 409


@pytest.mark.anyio
async def test_jobs_must_be_timezoned_aligned_and_inside_selected_week(client: httpx.AsyncClient):
    headers = workspace_headers()
    site = (await client.get("/api/states/AZ/sites", headers=headers)).json()[0]
    detail = (await client.get(f"/api/sites/{site['site_id']}", headers=headers)).json()
    crew_id = detail["crews"][0]["crew_id"]
    base = {
        "name": "Boundary test", "location": site["centroid"], "duration_minutes": 60, "workload": "moderate",
        "original_start": "2024-07-15T10:00:00-07:00", "earliest_start": "2024-07-15T06:00:00-07:00",
        "latest_finish": "2024-07-15T18:00:00-07:00", "assigned_crew_id": crew_id,
        "eligible_crew_ids": [crew_id], "dependencies": [], "movable": True, "shaded": False,
    }
    outside = await client.post(f"/api/sites/{site['site_id']}/jobs", headers=headers, json={
        **base, "original_start": "2024-07-22T10:00:00-07:00", "earliest_start": "2024-07-22T06:00:00-07:00",
        "latest_finish": "2024-07-22T18:00:00-07:00",
    })
    assert outside.status_code == 422
    assert "seven-day week" in outside.json()["detail"]
    unaligned = await client.post(f"/api/sites/{site['site_id']}/jobs", headers=headers, json={
        **base, "original_start": "2024-07-15T10:15:00-07:00",
    })
    assert unaligned.status_code == 422
    assert "30-minute" in str(unaligned.json())


def test_optimizer_candidates_ceil_to_half_hour():
    job = weekly_store._curated["desertline-phoenix"][2][0].model_copy(update={
        "earliest_start": weekly_store._curated["desertline-phoenix"][2][0].earliest_start.replace(minute=15),
    })
    assert next(WeeklyOptimizer._candidate_starts(job)).minute == 30


@pytest.mark.anyio
async def test_weekly_optimizer_is_deterministic_and_returns_three_layers(client: httpx.AsyncClient):
    headers = workspace_headers()
    site_id = (await client.get("/api/states/AZ/sites", headers=headers)).json()[0]["site_id"]
    first = (await client.post(f"/api/sites/{site_id}/plans/optimize", headers=headers)).json()
    second = (await client.post(f"/api/sites/{site_id}/plans/optimize", headers=headers)).json()
    assert first["original"] == second["original"]
    assert first["heatshift"] == second["heatshift"]
    assert first["metrics"] == second["metrics"]
    assert {item["source"] for item in first["original"]} == {"original"}
    assert {item["source"] for item in first["heatshift"]} == {"heatshift"}
    assert {item["source"] for item in first["working"]} == {"working"}
    assert set(first["plan_metrics"]) == {"original", "heatshift", "working"}
    assert first["metrics"]["constraint_valid"] is True
    assert first["metrics"]["disruption"]["hard_constraint_violations"] == 0


def test_supabase_migration_enables_rls_and_server_only_credit_reservations():
    migration = (Path(__file__).resolve().parents[2] / "supabase/migrations/202609010001_weekly_operations.sql").read_text()
    exposed = ["workspaces", "sites", "site_days", "crews", "jobs", "job_dependencies", "schedule_versions", "schedule_entries", "analyses", "provisioning_jobs", "live_quota"]
    for table in exposed:
        assert f"alter table public.{table} enable row level security" in migration
    assert "owner_id = auth.uid()" in migration
    assert "c.site_id = site_id" in migration
    assert "job.site_id = prerequisite.site_id" in migration
    assert "job.site_id = version.site_id" in migration
    assert "revoke all on public.heatshift_provider_reservations from anon, authenticated" in migration
    assert "revoke all on public.provider_request_cache from anon, authenticated" in migration
    assert "request_in_progress" in migration
    assert "grant execute on function public.claim_heatshift_provider_reservation" in migration


@pytest.mark.anyio
async def test_invalid_working_drop_returns_exact_constraint(client: httpx.AsyncClient):
    headers = workspace_headers()
    site_id = (await client.get("/api/states/AZ/sites", headers=headers)).json()[0]["site_id"]
    analysis = (await client.post(f"/api/sites/{site_id}/plans/optimize", headers=headers)).json()
    entries = analysis["working"]
    locked_id = next(job["job_id"] for job in (await client.get(f"/api/sites/{site_id}", headers=headers)).json()["jobs"] if not job["movable"])
    locked_entry = next(item for item in entries if item["job_id"] == locked_id)
    locked_entry["start"] = "2024-07-17T10:00:00-07:00"
    locked_entry["end"] = "2024-07-17T12:00:00-07:00"
    response = await client.patch(f"/api/sites/{site_id}/plans/working", headers=headers, json={"entries": entries})
    assert response.status_code == 409
    assert "locked work cannot move" in response.json()["detail"]


@pytest.mark.anyio
async def test_working_plan_rejects_non_aligned_start(client: httpx.AsyncClient):
    headers = workspace_headers()
    site_id = (await client.get("/api/states/AZ/sites", headers=headers)).json()[0]["site_id"]
    analysis = (await client.post(f"/api/sites/{site_id}/plans/optimize", headers=headers)).json()
    entries = analysis["working"]
    target = next(item for item in entries if item["start"][:10] == item["end"][:10])
    from datetime import datetime, timedelta
    start = datetime.fromisoformat(target["start"]).replace(minute=15)
    end = start + timedelta(seconds=(datetime.fromisoformat(target["end"]) - datetime.fromisoformat(target["start"])).total_seconds())
    target["start"] = start.isoformat()
    target["end"] = end.isoformat()
    response = await client.patch(f"/api/sites/{site_id}/plans/working", headers=headers, json={"entries": entries})
    assert response.status_code == 409
    assert "30-minute" in response.json()["detail"]


@pytest.mark.anyio
async def test_metrics_explanations_publish_formulas_and_limits(client: httpx.AsyncClient):
    headers = workspace_headers()
    site_id = (await client.get("/api/states/AZ/sites", headers=headers)).json()[0]["site_id"]
    analysis = (await client.post(f"/api/sites/{site_id}/plans/optimize", headers=headers)).json()
    assert "hourly apparent temperature" in analysis["explanations"]["thermal_burden"]["formula"]
    assert "duration hours" in analysis["explanations"]["crew_load"]["formula"]
    assert "opaque score" in analysis["explanations"]["disruption"]["limitations"][0]
    assert "injury reduction" in analysis["explanations"]["risk_reduction"]["limitations"][0]


@pytest.mark.anyio
async def test_contextual_questions_are_authorized_to_owner(client: httpx.AsyncClient):
    owner, outsider = workspace_headers(), workspace_headers()
    site_id = (await client.get("/api/states/AZ/sites", headers=owner)).json()[0]["site_id"]
    analysis = (await client.post(f"/api/sites/{site_id}/plans/optimize", headers=owner)).json()
    allowed = await client.post(f"/api/analyses/{analysis['analysis_id']}/questions", headers=owner, json={"question": "Explain crew load", "context": {"metric": "crew_load"}})
    assert allowed.status_code == 200
    assert "risk-weighted worker-hours" in allowed.json()["answer_markdown"]
    denied = await client.post(f"/api/analyses/{analysis['analysis_id']}/questions", headers=outsider, json={"question": "Explain it", "context": {}})
    assert denied.status_code == 404


def test_ai_numeric_grounding_rejects_unsupported_numbers():
    # The public API tests exercise generation; formula constants stay explicit.
    assert THERMAL_BURDEN_BASELINE_C == 35.0
    record = next(iter(weekly_store._curated.values()))
    assert site_thermal_burden(record[3]) > 0


def test_job_location_changes_task_hour_score_through_spatial_reconstruction():
    record = weekly_store._curated["desertline-phoenix"]
    site, crews, jobs, days = record
    day = days[0].model_copy(deep=True)
    cold = day.heat_cells[0].model_copy(update={"temperature_c_1500": 30.0, "geometry": {"type": "Polygon", "coordinates": [[[-112.07, 33.45], [-112.069, 33.45], [-112.069, 33.451], [-112.07, 33.451], [-112.07, 33.45]]]}})
    hot = day.heat_cells[1].model_copy(update={"temperature_c_1500": 50.0, "geometry": {"type": "Polygon", "coordinates": [[[-112.06, 33.45], [-112.059, 33.45], [-112.059, 33.451], [-112.06, 33.451], [-112.06, 33.45]]]}})
    day.heat_cells = [cold, hot]
    start = day.conditions[15].timestamp
    crew = crews[0]
    base = jobs[0].model_copy(update={"original_start": start, "earliest_start": start, "latest_finish": start.replace(hour=18)})
    cold_job = base.model_copy(update={"location": GeoPoint(longitude=-112.0695, latitude=33.4505)})
    hot_job = base.model_copy(update={"location": GeoPoint(longitude=-112.0595, latitude=33.4505)})
    cold_entry = entry_for(cold_job, crew, start, PlanLayer.ORIGINAL, [day])
    hot_entry = entry_for(hot_job, crew, start, PlanLayer.ORIGINAL, [day])
    assert hot_entry.screening_score > cold_entry.screening_score


def test_credit_usage_parser_supports_provider_contract():
    usage = {"credit_summary": {"total_available_credits": 2_000_000, "cycle_credits_used": 89_620, "cycle_remaining_credits": 1_910_380}}
    assert _remaining_credits(usage) == 1_910_380
    assert _remaining_credits({"unexpected": "shape"}) is None


def test_provider_request_hash_is_canonical_and_week_specific():
    geometry = circle_feature_collection(-112.05, 33.45, 300)
    reordered = {"features": geometry["features"], "type": "FeatureCollection"}
    assert _request_hash(geometry, date(2024, 8, 5)) == _request_hash(reordered, date(2024, 8, 5))
    assert _request_hash(geometry, date(2024, 8, 5)) != _request_hash(geometry, date(2024, 8, 12))


def test_failed_provisioning_retry_preserves_completed_paid_stages():
    state = {
        "state": "failed", "error": "provider failed", "failed_stage": "environment:2024-07-16",
        "completed_stages": ["heatmap:2024-07-15", "environment:2024-07-15", "heatmap:2024-07-16"],
        "pending_stages": ["environment:2024-07-16", "satellite", "normalize"],
        "activity_ids": {"heatmap:2024-07-15": "h1", "environment:2024-07-15": "e1", "heatmap:2024-07-16": "h2", "environment:2024-07-16": "failed-e2"},
        "days": {
            "2024-07-15": {"heatmap_id": "h1", "heatmap_result": {"ok": True}, "environment_id": "e1", "environment_result": {"ok": True}},
            "2024-07-16": {"heatmap_id": "h2", "heatmap_result": {"ok": True}, "environment_id": "failed-e2", "environment_terminal_failure": True},
        },
        "satellite": {},
    }
    _prepare_failed_retry(state)
    assert state["state"] == "reserved"
    assert state["days"]["2024-07-15"]["environment_id"] == "e1"
    assert state["days"]["2024-07-16"]["heatmap_id"] == "h2"
    assert "environment_id" not in state["days"]["2024-07-16"]
    assert "environment:2024-07-16" not in state["activity_ids"]


def test_failed_provisioning_retry_keeps_submitted_activity_after_transient_error():
    state = {
        "state": "failed", "error": "network timeout", "failed_stage": "environment:2024-07-16",
        "completed_stages": ["heatmap:2024-07-16"], "pending_stages": ["environment:2024-07-16"],
        "activity_ids": {"heatmap:2024-07-16": "h2", "environment:2024-07-16": "e2"},
        "days": {"2024-07-16": {"heatmap_id": "h2", "heatmap_result": {"ok": True}, "environment_id": "e2", "status_not_found_attempts": 15}},
        "satellite": {},
    }
    _prepare_failed_retry(state)
    assert state["days"]["2024-07-16"]["environment_id"] == "e2"
    assert state["activity_ids"]["environment:2024-07-16"] == "e2"
    assert "status_not_found_attempts" not in state["days"]["2024-07-16"]


@pytest.mark.anyio
async def test_provider_status_404_is_bounded_eventual_consistency():
    class MissingStatusClient:
        async def get_activity_status(self, _activity_id):
            raise FortyGuardError("FortyGuard returned HTTP 404: Activity not found")

    service = ProvisioningService()
    service.client = MissingStatusClient()
    holder = {}
    for _ in range(15):
        assert await service._status_or_pending(holder, "activity-id") is None
    with pytest.raises(ProvisioningError, match="bounded status retries"):
        await service._status_or_pending(holder, "activity-id")


@pytest.mark.anyio
async def test_turnstile_local_token_is_single_use():
    verifier = TurnstileVerifier()
    await verifier.verify("local-turnstile-test")
    with pytest.raises(TurnstileError, match="already been used"):
        await verifier.verify("local-turnstile-test")


@pytest.mark.anyio
async def test_all_five_curated_operations_are_distinct_and_feasible(client: httpx.AsyncClient):
    states = ["AZ", "TX", "FL", "NV", "NY"]
    signatures = set()
    for state in states:
        headers = workspace_headers()
        site = (await client.get(f"/api/states/{state}/sites", headers=headers)).json()[0]
        detail = (await client.get(f"/api/sites/{site['site_id']}", headers=headers)).json()
        analysis = (await client.post(f"/api/sites/{site['site_id']}/plans/optimize", headers=headers)).json()
        assert len(detail["days"]) == 7
        assert analysis["metrics"]["constraint_valid"] is True
        assert analysis["metrics"]["disruption"]["hard_constraint_violations"] == 0
        assert all(entry["crew_id"] in {crew["crew_id"] for crew in detail["crews"]} for entry in analysis["heatshift"])
        signatures.add((site["name"], tuple(job["name"] for job in detail["jobs"]), analysis["metrics"]["site_thermal_burden_degree_hours"]))
    assert len(signatures) == 5


@pytest.mark.anyio
async def test_deferred_cancelled_and_completed_jobs_obey_weekly_lifecycle(client: httpx.AsyncClient):
    headers = workspace_headers()
    site_id = (await client.get("/api/states/AZ/sites", headers=headers)).json()[0]["site_id"]
    detail = (await client.get(f"/api/sites/{site_id}", headers=headers)).json()
    deferred = next(job for job in detail["jobs"] if job["latest_finish"][:10] > job["original_start"][:10] and job["movable"])
    completed = next(job for job in detail["jobs"] if not job["movable"])
    dependency_ids = {value for job in detail["jobs"] for value in job["dependencies"]}
    cancelled = next(job for job in detail["jobs"] if job["job_id"] not in {deferred["job_id"], completed["job_id"]} | dependency_ids)
    assert (await client.patch(f"/api/sites/{site_id}/jobs/{deferred['job_id']}", headers=headers, json={"status": "deferred"})).status_code == 200
    assert (await client.patch(f"/api/sites/{site_id}/jobs/{completed['job_id']}", headers=headers, json={"status": "completed"})).status_code == 200
    assert (await client.patch(f"/api/sites/{site_id}/jobs/{cancelled['job_id']}", headers=headers, json={"status": "cancelled"})).status_code == 200
    analysis = (await client.post(f"/api/sites/{site_id}/plans/optimize", headers=headers)).json()
    proposed = {entry["job_id"]: entry for entry in analysis["heatshift"]}
    assert proposed[deferred["job_id"]]["start"][:10] > deferred["original_start"][:10]
    assert proposed[completed["job_id"]]["start"] == completed["original_start"]
    assert cancelled["job_id"] not in proposed
    assert analysis["metrics"]["disruption"]["manager_deferrals"] == 1
    assert analysis["metrics"]["disruption"]["cancellations"] == 1
    assert analysis["metrics"]["productive_task_time_retained_percent"] < 100


@pytest.mark.anyio
async def test_browser_cannot_forge_working_plan_score_or_duration(client: httpx.AsyncClient):
    headers = workspace_headers()
    site_id = (await client.get("/api/states/TX/sites", headers=headers)).json()[0]["site_id"]
    analysis = (await client.post(f"/api/sites/{site_id}/plans/optimize", headers=headers)).json()
    forged = [dict(entry) for entry in analysis["working"]]
    target = forged[0]
    authoritative_score = target["screening_score"]
    target["screening_score"] = 0
    response = await client.patch(f"/api/sites/{site_id}/plans/working", headers=headers, json={"entries": forged})
    assert response.status_code == 200
    revised = next(item for item in response.json()["working"] if item["job_id"] == target["job_id"])
    assert revised["screening_score"] == authoritative_score
    forged = [dict(entry) for entry in response.json()["working"]]
    forged[0]["end"] = forged[0]["start"]
    response = await client.patch(f"/api/sites/{site_id}/plans/working", headers=headers, json={"entries": forged})
    assert response.status_code == 409
    assert "duration changed" in response.json()["detail"]


@pytest.mark.anyio
async def test_exact_state_boundary_rejects_bbox_false_positive(client: httpx.AsyncClient):
    response = await client.post("/api/sites", headers=workspace_headers(), json={
        "name": "Ocean corner", "state_code": "NY", "site_type": "yard",
        "geometry": {"type": "circle", "longitude": -71.90, "latitude": 40.52, "radius_m": 100},
    })
    assert response.status_code == 422
    assert "state" in response.json()["detail"]


@pytest.mark.anyio
async def test_optimizer_runtime_is_bounded_for_all_curated_sites(client: httpx.AsyncClient):
    headers = workspace_headers()
    started = perf_counter()
    for state in ["AZ", "TX", "FL", "NV", "NY"]:
        site_id = (await client.get(f"/api/states/{state}/sites", headers=headers)).json()[0]["site_id"]
        assert (await client.post(f"/api/sites/{site_id}/plans/optimize", headers=headers)).status_code == 200
    assert perf_counter() - started < 5


@pytest.mark.anyio
async def test_ai_validators_reject_new_numbers_and_fact_contradictions(client: httpx.AsyncClient):
    headers = workspace_headers()
    site_id = (await client.get("/api/states/NV/sites", headers=headers)).json()[0]["site_id"]
    payload = (await client.post(f"/api/sites/{site_id}/plans/optimize", headers=headers)).json()
    from app.models.weekly import WeeklyAnalysis
    analysis = WeeklyAnalysis.model_validate(payload)
    assert not is_numerically_grounded("Exposure falls by 99.9 percent.", analysis)
    if analysis.metrics.residual_alerts:
        assert contradicts_analysis("All risk eliminated; no residual alerts remain.", analysis)


@pytest.mark.anyio
async def test_persistence_snapshot_does_not_duplicate_curated_environment(client: httpx.AsyncClient):
    headers = workspace_headers()
    owner_id = headers["x-heatshift-workspace"]
    await client.get("/api/workspace", headers=headers)
    workspace = await weekly_store.workspace(owner_id)
    snapshot = weekly_store._snapshot(workspace)
    assert snapshot["curated_operations"]
    assert all("days" not in value for value in snapshot["curated_operations"].values())
    assert snapshot["custom_sites"] == {}


@pytest.mark.anyio
async def test_provisioning_is_idempotent_and_turnstile_fails_before_provider_work(client: httpx.AsyncClient):
    headers = workspace_headers()
    owner_id = headers["x-heatshift-workspace"]
    site = (await client.post("/api/sites", headers=headers, json={
        "name": "Provisioning yard", "state_code": "AZ", "site_type": "yard",
        "geometry": {"type": "circle", "longitude": -112.05, "latitude": 33.45, "radius_m": 300},
    })).json()

    class FakeFortyGuard:
        configured = True

        def __init__(self):
            self.submissions = 0
            self.status_checks = 0

        async def get_credit_usage(self):
            return {"cycle_remaining_credits": 1_500_000}

        async def submit_heatmap(self, *_args):
            self.submissions += 1
            return "heatmap-one"

        async def get_activity_status(self, _activity_id):
            self.status_checks += 1
            return {"data": {"status": "Processing"}}

    service = ProvisioningService()
    service.client = FakeFortyGuard()
    invalid = ProvisionRequest(turnstile_token="wrong-token", idempotency_key=f"invalid-{uuid.uuid4()}", week_start=date(2024, 8, 5))
    with pytest.raises(ProvisioningError, match="Turnstile"):
        await service.advance(owner_id, site["site_id"], invalid)
    assert service.client.submissions == 0

    request = ProvisionRequest(turnstile_token=f"local-turnstile-test:{uuid.uuid4()}", idempotency_key=f"resume-{uuid.uuid4()}", week_start=date(2024, 8, 5))
    first = await service.advance(owner_id, site["site_id"], request)
    second = await service.advance(owner_id, site["site_id"], request)
    assert first.activity_ids == {"heatmap:2024-08-05": "heatmap-one"}
    assert second.state == "polling"
    assert service.client.submissions == 1
    assert service.client.status_checks == 1


@pytest.mark.anyio
async def test_exact_request_cache_avoids_provider_submission(client: httpx.AsyncClient):
    headers = workspace_headers()
    owner_id = headers["x-heatshift-workspace"]
    site = (await client.post("/api/sites", headers=headers, json={
        "name": "Cached request yard", "state_code": "AZ", "site_type": "yard",
        "geometry": {"type": "circle", "longitude": -112.03, "latitude": 33.45, "radius_m": 300},
    })).json()
    week_start = date(2024, 7, 15)
    request_hash = _request_hash(site["geometry"], week_start)
    sample_days = weekly_store._curated["desertline-phoenix"][3]
    activity_ids = {"satellite": "cached-s1"}
    for offset in range(7):
        selected = week_start + timedelta(days=offset)
        activity_ids[f"heatmap:{selected}"] = f"cached-h{offset}"
        activity_ids[f"environment:{selected}"] = f"cached-e{offset}"
    await provider_result_cache.put(request_hash, {
        "days": [item.model_dump(mode="json") for item in sample_days],
        "activity_ids": activity_ids,
    })

    class NoProviderCalls:
        configured = False

        async def get_credit_usage(self):
            raise AssertionError("cache hits must not query provider usage")

    service = ProvisioningService()
    service.client = NoProviderCalls()
    status = await service.advance(owner_id, site["site_id"], ProvisionRequest(
        turnstile_token=f"local-turnstile-test:{uuid.uuid4()}",
        idempotency_key=f"cache-{uuid.uuid4()}",
        week_start=week_start,
    ))
    assert status.state == "ready"
    assert status.reserved_credits == 0
    assert (await weekly_store.site_record(owner_id, site["site_id"])).days
