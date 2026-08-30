#!/usr/bin/env python3
"""Fetch real hourly environmental parameters for the saved demo heatmap."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
HEATMAP_PATH = ROOT / "data/cache/fortyguard_demo_response.json"
OUTPUT_PATH = ROOT / "data/cache/fortyguard_environment_response.json"
BASE_URL = os.getenv("FORTYGUARD_BASE_URL", "https://api.fortyguard.com").rstrip("/")


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
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"FortyGuard returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not reach FortyGuard: {exc.reason}") from exc


def main() -> int:
    api_key = os.getenv("FORTYGUARD_API_KEY")
    if not api_key:
        print("FORTYGUARD_API_KEY is not configured.", file=sys.stderr)
        return 2
    if not HEATMAP_PATH.exists():
        print(f"Run test_fortyguard_access.py first; missing {HEATMAP_PATH}", file=sys.stderr)
        return 2

    heatmap = json.loads(HEATMAP_PATH.read_text())
    stats = heatmap["response"]["data"]["result"]["stats_data"]["temperature_stats"]
    date_time = heatmap["request"]["date_time"]
    payload = {
        "latitude": 33.4515,
        "longitude": -112.0675,
        "temperature": stats["mean"],
        "date_time": {
            "start_date": date_time["start_date"],
            "start_time": "06:00",
            "end_time": "16:00",
            "filter_type": 2,
        },
    }

    submitted = request_json("POST", "/v1/env_params", api_key, payload)
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
    count = result.get("metadata", {}).get("time_range", {}).get("count", 0)
    print(f"Saved completed real response with {count} observations to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
