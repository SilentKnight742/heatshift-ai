#!/usr/bin/env python3
"""Capture additional real FortyGuard replays for the offline evaluation suite."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import date
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.getenv("FORTYGUARD_BASE_URL", "https://api.fortyguard.com").rstrip("/")
POLYGON = {
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
}


def request_json(method: str, path: str, api_key: str, payload: dict | None = None) -> dict:
    request = Request(
        f"{BASE_URL}{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={"api-key": api_key, "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=45) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f"FortyGuard returned HTTP {exc.code}: {exc.read().decode()}") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not reach FortyGuard: {exc.reason}") from exc


def submit_and_wait(path: str, payload: dict, api_key: str) -> dict:
    submitted = request_json("POST", path, api_key, payload)
    activity_id = submitted.get("data", {}).get("activity_id")
    if not activity_id:
        raise RuntimeError(f"Submission did not return an activity ID: {submitted}")
    print(f"  submitted {path}: {activity_id}")
    for attempt in range(30):
        response = request_json("GET", f"/v1/status/{activity_id}", api_key)
        status = str(response.get("data", {}).get("status", "unknown"))
        print(f"  poll {attempt + 1}: {status}")
        if status.lower() in {"completed", "succeeded"}:
            return response
        if status.lower() in {"failed", "error"}:
            raise RuntimeError(f"Activity {activity_id} failed")
        time.sleep(min(2 + attempt, 10))
    raise TimeoutError(f"Activity {activity_id} did not complete")


def capture(day: str, api_key: str) -> None:
    date.fromisoformat(day)
    heatmap_request = {
        "polygon_aoi": POLYGON,
        "date_time": {"start_date": day, "start_time": "15:00", "filter_type": 1},
        "granularity": 100,
    }
    print(f"Capturing {day}")
    heatmap = submit_and_wait("/v1/heatmap", heatmap_request, api_key)
    result = heatmap["data"]["result"]
    if not result.get("map_data", {}).get("features"):
        raise RuntimeError(f"Heatmap for {day} returned no cells")
    mean_temperature = result["stats_data"]["temperature_stats"]["mean"]
    environment_request = {
        "latitude": 33.4515,
        "longitude": -112.0675,
        "temperature": mean_temperature,
        "date_time": {
            "start_date": day,
            "start_time": "06:00",
            "end_time": "16:00",
            "filter_type": 2,
        },
    }
    environment = submit_and_wait("/v1/env_params", environment_request, api_key)
    count = environment["data"]["result"].get("metadata", {}).get("time_range", {}).get("count", 0)
    if not count:
        raise RuntimeError(f"Environmental request for {day} returned no observations")
    output = ROOT / f"data/cache/evaluation_{day}.json"
    output.write_text(
        json.dumps(
            {
                "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "heatmap_request": heatmap_request,
                "heatmap_response": heatmap,
                "environment_request": environment_request,
                "environment_response": environment,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"  saved {len(result['map_data']['features'])} cells and {count} observations to {output}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dates", nargs="+", help="Historical dates in YYYY-MM-DD format")
    args = parser.parse_args()
    api_key = os.getenv("FORTYGUARD_API_KEY")
    if not api_key:
        raise RuntimeError("FORTYGUARD_API_KEY is not configured")
    for day in args.dates:
        capture(day, api_key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
