#!/usr/bin/env python3
"""Submit a minimal Phoenix heatmap request and save the completed real response.

This is intentionally separate from the normal test suite because a successful
run consumes FortyGuard credits. The API key is read from the environment and
is never written to disk.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE_URL = os.getenv("FORTYGUARD_BASE_URL", "https://api.fortyguard.com").rstrip("/")
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data/cache/fortyguard_demo_response.json"


def request_json(method: str, path: str, api_key: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode() if payload is not None else None
    request = Request(
        f"{BASE_URL}{path}",
        data=body,
        method=method,
        headers={"api-key": api_key, "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=45) as response:
            return json.load(response)
    except HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"FortyGuard returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not reach FortyGuard: {exc.reason}") from exc


def main() -> int:
    api_key = os.getenv("FORTYGUARD_API_KEY")
    if not api_key:
        print("FORTYGUARD_API_KEY is not configured.", file=sys.stderr)
        return 2

    payload = {
        "polygon_aoi": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"name": "DesertLine Logistics Yard"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[
                            [-112.0750, 33.4450],
                            [-112.0600, 33.4450],
                            [-112.0600, 33.4580],
                            [-112.0750, 33.4580],
                            [-112.0750, 33.4450],
                        ]],
                    },
                }
            ],
        },
        "date_time": {
            "start_date": "2026-08-28",
            "start_time": "15:00",
            "filter_type": 1,
        },
        "granularity": 100,
    }

    submitted = request_json("POST", "/v1/heatmap", api_key, payload)
    activity_id = submitted.get("data", {}).get("activity_id")
    if not activity_id:
        raise RuntimeError(f"Submission did not return an activity ID: {submitted}")
    print(f"Submitted activity {activity_id}")

    completed = None
    for attempt in range(30):
        response = request_json("GET", f"/v1/status/{activity_id}", api_key)
        status = str(response.get("data", {}).get("status", "unknown"))
        print(f"Poll {attempt + 1}: {status}")
        if status.lower() in {"completed", "succeeded"}:
            completed = response
            break
        if status.lower() in {"failed", "error"}:
            raise RuntimeError(f"Activity {activity_id} failed: {response}")
        time.sleep(min(2 + attempt, 10))

    if completed is None:
        raise TimeoutError(f"Activity {activity_id} did not complete within the polling window")

    fixture = {
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "request": payload,
        "response": completed,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(fixture, indent=2) + "\n")
    result = completed.get("data", {}).get("result", {})
    feature_count = len(result.get("map_data", {}).get("features", []))
    print(f"Saved completed real response with {feature_count} map features to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
