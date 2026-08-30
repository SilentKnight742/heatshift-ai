from __future__ import annotations

import asyncio
import copy

import httpx
import pytest

from app.main import app
from app.services.cache import analysis_store


async def request(method: str, path: str, **kwargs) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


def reference_payload() -> dict:
    scenario = asyncio.run(request("GET", "/api/demo/scenario")).json()
    return {
        "site": scenario["site"],
        "crews": scenario["crews"],
        "shift": scenario["shift"],
        "environment_source": "phoenix_reference",
    }


def analyze(payload: dict) -> httpx.Response:
    return asyncio.run(request("POST", "/api/analyze", json=payload))


def task(
    task_id: str,
    start: str,
    *,
    crew_id: str = "alpha",
    duration: int = 60,
    workload: str = "heavy",
    movable: bool = True,
    earliest: str = "06:00",
    latest: str = "16:00",
    dependencies: list[str] | None = None,
) -> dict:
    return {
        "task_id": task_id,
        "name": task_id.replace("-", " ").title(),
        "crew_id": crew_id,
        "location": {"longitude": -112.069, "latitude": 33.4514},
        "duration_minutes": duration,
        "workload": workload,
        "scheduled_start": f"2026-08-28T{start}:00-07:00",
        "earliest_start": f"2026-08-28T{earliest}:00-07:00",
        "latest_finish": f"2026-08-28T{latest}:00-07:00",
        "movable": movable,
        "dependencies": dependencies or [],
        "shaded": False,
    }


def assert_schedule_invariants(body: dict) -> None:
    original = {item["task_id"]: item for item in body["baseline_schedule"]}
    optimized = {item["task_id"]: item for item in body["optimized_schedule"]}
    tasks = {item["task_id"]: item for item in body["tasks"]}

    assert set(original) == set(optimized) == set(tasks)
    for task_id, original_item in original.items():
        assert optimized[task_id]["end"] > optimized[task_id]["start"]
        if not original_item["movable"]:
            assert optimized[task_id]["start"] == original_item["start"]
        for dependency_id in tasks[task_id]["dependencies"]:
            assert optimized[task_id]["start"] >= optimized[dependency_id]["end"]

    items = list(optimized.values())
    for index, left in enumerate(items):
        for right in items[index + 1 :]:
            if left["crew_id"] == right["crew_id"]:
                assert left["end"] <= right["start"] or right["end"] <= left["start"]

    assert body["metrics"]["productivity_retained_percent"] == 100.0
    assert body["metrics"]["optimized_exposed_worker_minutes"] <= body["metrics"]["baseline_exposed_worker_minutes"]


def test_all_fixed_scenario_retains_schedule_and_residual_risk() -> None:
    payload = reference_payload()
    for item in payload["shift"]["tasks"]:
        item["movable"] = False

    response = analyze(payload)

    assert response.status_code == 200
    body = response.json()
    assert body["movements"] == []
    assert body["metrics"]["tasks_moved"] == 0
    assert body["metrics"]["exposure_reduction_percent"] == 0.0
    assert body["metrics"]["baseline_exposed_worker_minutes"] == body["metrics"]["optimized_exposed_worker_minutes"]
    assert body["worker_alerts"], "fixed high-risk work must remain visible"
    assert_schedule_invariants(body)


def test_dense_same_crew_scenario_finds_distinct_cooler_slots() -> None:
    payload = reference_payload()
    payload["crews"] = [payload["crews"][0]]
    payload["shift"]["tasks"] = [
        task("fixed-inspection", "08:00", workload="moderate", movable=False, earliest="08:00", latest="09:00"),
        task("heavy-one", "12:00"),
        task("heavy-two", "13:00"),
        task("heavy-three", "14:00"),
    ]

    response = analyze(payload)

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["tasks_moved"] >= 2
    assert body["metrics"]["optimized_exposed_worker_minutes"] < body["metrics"]["baseline_exposed_worker_minutes"]
    assert_schedule_invariants(body)


def test_dependency_chain_remains_ordered_after_optimization() -> None:
    payload = reference_payload()
    payload["crews"] = [payload["crews"][0]]
    payload["shift"]["tasks"] = [
        task("prepare", "12:00"),
        task("execute", "13:00", dependencies=["prepare"]),
        task("inspect", "14:00", workload="moderate", dependencies=["execute"]),
    ]

    response = analyze(payload)

    assert response.status_code == 200
    body = response.json()
    optimized = {item["task_id"]: item for item in body["optimized_schedule"]}
    assert optimized["prepare"]["end"] <= optimized["execute"]["start"]
    assert optimized["execute"]["end"] <= optimized["inspect"]["start"]
    assert_schedule_invariants(body)


def test_critical_fixed_new_worker_case_cannot_hide_exposure() -> None:
    payload = reference_payload()
    payload["crews"] = [{
        "crew_id": "alpha",
        "name": "New PPE Crew",
        "worker_count": 100,
        "acclimatization_status": "new",
        "ppe_level": "high",
        "default_workload": "very_heavy",
    }]
    payload["shift"]["tasks"] = [
        task("critical-fixed-work", "14:00", workload="very_heavy", movable=False, earliest="14:00", latest="15:00")
    ]

    response = analyze(payload)

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["maximum_screening_score"] == 100
    assert body["metrics"]["baseline_exposed_worker_minutes"] == 6000
    assert body["metrics"]["optimized_exposed_worker_minutes"] == 6000
    assert body["metrics"]["exposure_reduction_percent"] == 0.0
    assert body["worker_alerts"][0]["severity"] == "critical"
    assert any(item["priority"] == "critical" for item in body["recommendations"])
    assert_schedule_invariants(body)


def test_repeat_custom_analysis_is_deterministic_and_stateless() -> None:
    payload = reference_payload()
    first = analyze(payload)
    second = analyze(payload)

    assert first.status_code == second.status_code == 200
    left = first.json()
    right = second.json()
    for key in ("baseline_schedule", "optimized_schedule", "movements", "metrics", "recommendations", "worker_alerts"):
        assert left[key] == right[key]
    assert left["analysis_id"] != right["analysis_id"]
    assert asyncio.run(analysis_store.get(left["analysis_id"])) is None
    assert asyncio.run(analysis_store.get(right["analysis_id"])) is None


@pytest.mark.parametrize(
    ("mutation", "message_fragment"),
    [
        (lambda payload: payload["site"].update({"site_id": "another-yard"}), "pinned Phoenix reference footprint"),
        (lambda payload: payload["site"].update({"timezone": "UTC"}), "timezones must match"),
        (lambda payload: payload["shift"].update({"timezone": "UTC"}), "timezones must match"),
        (lambda payload: payload["shift"].update({"shift_start": "2026-08-28T05:30:00-07:00"}), "06:00–16:00"),
        (lambda payload: payload["site"]["cooling_zone_coordinates"].update({"longitude": 0}), "inside the reference footprint"),
        (lambda payload: payload["shift"]["tasks"][0].update({"crew_id": "unknown"}), "unknown crews"),
        (lambda payload: payload["shift"]["tasks"][0].update({"dependencies": ["unknown"]}), "unknown dependency"),
        (lambda payload: payload["shift"]["tasks"][0].update({"unexpected": True}), "Extra inputs are not permitted"),
    ],
)
def test_invalid_scenario_matrix_is_rejected(mutation, message_fragment: str) -> None:
    payload = reference_payload()
    mutation(payload)

    response = analyze(payload)

    assert response.status_code == 422
    assert message_fragment in response.text


def test_duplicate_ids_cycles_bounds_and_overlaps_are_rejected() -> None:
    cases: list[dict] = []

    duplicate_crews = reference_payload()
    duplicate_crews["crews"].append(copy.deepcopy(duplicate_crews["crews"][0]))
    cases.append(duplicate_crews)

    duplicate_tasks = reference_payload()
    cloned_task = copy.deepcopy(duplicate_tasks["shift"]["tasks"][0])
    cloned_task["scheduled_start"] = "2026-08-28T07:00:00-07:00"
    cloned_task["earliest_start"] = "2026-08-28T07:00:00-07:00"
    cloned_task["latest_finish"] = "2026-08-28T08:00:00-07:00"
    duplicate_tasks["shift"]["tasks"].append(cloned_task)
    cases.append(duplicate_tasks)

    overlap = reference_payload()
    overlap["shift"]["tasks"][2]["scheduled_start"] = "2026-08-28T06:30:00-07:00"
    overlap["shift"]["tasks"][2]["earliest_start"] = "2026-08-28T06:00:00-07:00"
    cases.append(overlap)

    cycle = reference_payload()
    cycle["shift"]["tasks"] = [
        task("a", "12:00", dependencies=["b"]),
        task("b", "13:00", dependencies=["a"]),
    ]
    cases.append(cycle)

    too_many_crews = reference_payload()
    too_many_crews["crews"] = [
        {**copy.deepcopy(too_many_crews["crews"][0]), "crew_id": f"crew-{index}"}
        for index in range(9)
    ]
    too_many_crews["shift"]["tasks"][0]["crew_id"] = "crew-0"
    cases.append(too_many_crews)

    for payload in cases:
        assert analyze(payload).status_code == 422
