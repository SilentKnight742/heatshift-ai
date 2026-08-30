#!/usr/bin/env python3
"""Run the public HeatShift API acceptance contract with no extra dependencies."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
import uuid
from typing import Any


EXPECTED_TOOLS = [
    "get_site_heat",
    "load_shift_plan",
    "calculate_exposure_risk",
    "optimize_shift",
    "get_policy_guidance",
    "create_worker_alerts",
]


def request(
    base_url: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes, float]:
    body = json.dumps(payload).encode() if payload is not None else None
    request_headers = {"accept": "application/json", **(headers or {})}
    if body is not None:
        request_headers["content-type"] = "application/json"
    req = urllib.request.Request(
        f"{base_url}{path}",
        data=body,
        headers=request_headers,
        method=method,
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=150) as response:
            response_body = response.read()
            status = response.status
            response_headers = {
                key.lower(): value for key, value in response.headers.items()
            }
    except urllib.error.HTTPError as exc:
        response_body = exc.read()
        status = exc.code
        response_headers = {key.lower(): value for key, value in exc.headers.items()}
    elapsed = round(time.perf_counter() - started, 3)
    return status, response_headers, response_body, elapsed


def json_request(*args, **kwargs) -> tuple[int, dict[str, str], Any, float]:
    status, headers, body, elapsed = request(*args, **kwargs)
    return status, headers, json.loads(body), elapsed


def validate_result(result: dict[str, Any], require_llm: bool) -> None:
    assert result["status"] == "completed"
    assert result["metrics"]["baseline_exposed_worker_minutes"] == 1230
    assert result["metrics"]["optimized_exposed_worker_minutes"] == 270
    assert result["metrics"]["exposure_reduction_percent"] == 78.0
    assert result["metrics"]["productivity_retained_percent"] == 100.0
    assert len(result["heatmap_geojson"]["features"]) == 198
    assert len(result["observations"]) == 11
    traces = result["agent"]["tool_trace"]
    assert [trace["tool"] for trace in traces] == EXPECTED_TOOLS
    assert all(trace["success"] for trace in traces)
    if require_llm:
        assert result["agent"]["mode"] == "llm_tool_calling"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "base_url",
        nargs="?",
        default="https://heatshift-ai-api.vercel.app",
    )
    parser.add_argument(
        "--require-llm",
        action="store_true",
        help="Fail unless the free hosted LLM path completes instead of falling back.",
    )
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")
    timings: dict[str, float] = {}

    status, _, root, timings["root"] = json_request(base_url, "GET", "/")
    assert status == 200 and root["name"] == "HeatShift AI API"

    status, _, health, timings["health"] = json_request(base_url, "GET", "/health")
    assert status == 200 and health["status"] == "ok"
    assert health["fortyguard"]["mode"] == "cached"
    assert health["fortyguard"]["cached_real_response_available"] is True
    assert health["llm"]["configured"] is True
    assert health["deployment"]["stateless_replay_recovery"] is True

    status, _, schema, timings["openapi"] = json_request(base_url, "GET", "/openapi.json")
    assert status == 200
    expected_paths = {
        "/health",
        "/api/demo",
        "/api/demo/scenario",
        "/api/analyses",
        "/api/analyses/{analysis_id}",
        "/api/analyses/{analysis_id}/agent",
    }
    assert expected_paths.issubset(schema["paths"])

    status, _, docs_body, timings["docs"] = request(base_url, "GET", "/docs")
    assert status == 200 and b"swagger-ui" in docs_body.lower()

    status, _, scenario, timings["scenario"] = json_request(
        base_url, "GET", "/api/demo/scenario"
    )
    assert status == 200 and scenario["fictional_operation"] is True
    assert len(scenario["crews"]) == 3
    assert len(scenario["shift"]["tasks"]) == 6

    status, cors_headers, _, timings["cors"] = request(
        base_url,
        "OPTIONS",
        "/api/demo",
        headers={
            "origin": "http://localhost:3000",
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
        },
    )
    assert status == 200
    assert cors_headers.get("access-control-allow-origin") == "http://localhost:3000"

    status, _, demo, timings["demo"] = json_request(base_url, "POST", "/api/demo")
    assert status == 200
    validate_result(demo, args.require_llm)

    status, _, job, timings["create_job"] = json_request(
        base_url, "POST", "/api/analyses", payload={}
    )
    assert status == 201 and job["status"] == "completed"
    validate_result(job["result"], False)
    analysis_id = job["analysis_id"]

    status, _, fetched, timings["get_job"] = json_request(
        base_url, "GET", f"/api/analyses/{analysis_id}"
    )
    assert status == 200 and fetched["analysis_id"] == analysis_id

    cold_analysis_id = str(uuid.uuid4())
    status, _, cold_replay, timings["cold_recovery"] = json_request(
        base_url, "GET", f"/api/analyses/{cold_analysis_id}"
    )
    assert status == 200 and cold_replay["analysis_id"] == cold_analysis_id
    assert cold_replay["status"] == "completed"
    validate_result(cold_replay["result"], False)

    status, _, rerun, timings["rerun_agent"] = json_request(
        base_url, "POST", f"/api/analyses/{analysis_id}/agent"
    )
    assert status == 200
    validate_result(rerun, False)

    status, _, _, timings["reject_custom"] = json_request(
        base_url,
        "POST",
        "/api/analyses",
        payload={"site": {"site_id": "unsupported"}},
    )
    assert status == 422

    status, _, _, timings["missing_job"] = json_request(
        base_url, "GET", "/api/analyses/not-an-analysis-id"
    )
    assert status == 404

    public_payload = json.dumps(
        [root, health, scenario, demo, job, fetched, cold_replay, rerun]
    )
    assert "gsk_" not in public_payload
    assert "Bearer " not in public_payload

    print(
        json.dumps(
            {
                "status": "passed",
                "base_url": base_url,
                "demo_agent_mode": demo["agent"]["mode"],
                "job_agent_mode": job["result"]["agent"]["mode"],
                "rerun_agent_mode": rerun["agent"]["mode"],
                "checks": 13,
                "timings_seconds": timings,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
