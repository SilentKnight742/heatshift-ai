#!/usr/bin/env python3
"""Seed the five immutable curated site-weeks into Supabase.

This command only uploads normalized files already present in ``data/curated``.
It never calls FortyGuard and therefore cannot consume provider credits. The
upserts are idempotent on ``sites.system_key`` and ``(site_id, observation_date)``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.state_catalog import circle_feature_collection  # noqa: E402
from app.services.supabase_admin import supabase_admin_headers  # noqa: E402


class CuratedSeedError(RuntimeError):
    pass


def _hourly_cells(day: dict[str, Any]) -> dict[str, Any]:
    cells = day["heat_cells"]
    conditions = day["conditions"]
    if not cells or len(conditions) != 24:
        raise CuratedSeedError(f"{day['date']}: expected heat cells and 24 hourly observations")
    mean_1500 = sum(float(cell["temperature_c_1500"]) for cell in cells) / len(cells)
    hours = []
    for condition in conditions:
        derived = []
        for cell in cells:
            offset = float(cell["temperature_c_1500"]) - mean_1500
            derived.append({
                "cell_id": cell["cell_id"],
                "temperature_c": round(float(condition["temperature_c"]) + offset, 2),
                "apparent_temperature_c": round(float(condition["apparent_temperature_c"]) + offset, 2),
                "source": "HeatShift-derived interpolation",
            })
        hours.append({"timestamp": condition["timestamp"], "cells": derived})
    return {
        "formula": "hourly site apparent temperature + (15:00 cell temperature - 15:00 heatmap mean)",
        "heatmap_mean_c_1500": round(mean_1500, 4),
        "hours": hours,
    }


def build_seed_payloads() -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    payloads = []
    paths = sorted((ROOT / "data" / "curated").glob("*/week-2024-07-15.json"))
    if len(paths) != 5:
        raise CuratedSeedError(f"Expected five curated site-weeks, found {len(paths)}")
    for path in paths:
        raw = path.read_bytes()
        cached = json.loads(raw)
        site = cached["site"]
        file_sha = hashlib.sha256(raw).hexdigest()
        site_row = {
            "owner_id": None,
            "system_key": site["site_id"],
            "name": site["name"],
            "state_code": site["state_code"],
            "site_type": site["site_type"],
            "geometry": circle_feature_collection(site["longitude"], site["latitude"], 600),
            "centroid": {"longitude": site["longitude"], "latitude": site["latitude"]},
            "timezone": site["timezone"],
            "curated": True,
            "fictional_operation": True,
            "data_status": "ready",
            "evidence_week_start": cached["week_start"],
            "source_label": f"Cached FortyGuard site-week · SHA-256 {file_sha[:12]}…",
        }
        day_rows = []
        satellite_activity_id = cached["activity_ids"]["satellite"]
        for day in cached["days"]:
            day_rows.append({
                "observation_date": day["date"],
                "heatmap": {
                    "activity_id": day["heatmap_activity_id"],
                    "granularity_m": 100,
                    "local_snapshot_time": "15:00",
                    "cells": day["heat_cells"],
                },
                "hourly_observations": day["conditions"],
                "derived_hourly_cells": _hourly_cells(day),
                "satellite_context": day["satellite_context"],
                "provenance": {
                    "environment": "real cached FortyGuard response",
                    "operation": "fictional HeatShift scenario",
                    "hourly_cells": "HeatShift-derived interpolation",
                    "heatmap_activity_id": day["heatmap_activity_id"],
                    "environmental_activity_id": day["environmental_activity_id"],
                    "satellite_activity_id": satellite_activity_id,
                    "source_file_sha256": file_sha,
                },
                "integrity_sha256": day["integrity_sha256"],
                "immutable": True,
            })
        if len(day_rows) != 7:
            raise CuratedSeedError(f"{site['site_id']}: expected seven days, found {len(day_rows)}")
        payloads.append((site_row, day_rows))
    return payloads


def _upsert(client: httpx.Client, path: str, conflict: str, payload: Any) -> Any:
    response = client.post(
        path,
        params={"on_conflict": conflict},
        headers={"prefer": "resolution=merge-duplicates,return=representation"},
        json=payload,
    )
    if response.status_code >= 400:
        raise CuratedSeedError(f"Supabase rejected {path} ({response.status_code}): {response.text[:500]}")
    return response.json()


def seed(execute: bool) -> None:
    payloads = build_seed_payloads()
    cells = sum(len(day["heatmap"]["cells"]) for _, days in payloads for day in days)
    print(f"Validated {len(payloads)} curated sites, {sum(len(days) for _, days in payloads)} days and {cells} daily cells.")
    if not execute:
        print("Dry run only. Pass --execute to upsert the checked-in cache into Supabase.")
        return
    load_dotenv(ROOT / ".env")
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    secret = os.getenv("SUPABASE_SECRET_KEY", "")
    if not url or not secret:
        raise CuratedSeedError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    headers = supabase_admin_headers(secret)
    with httpx.Client(base_url=f"{url}/rest/v1", headers=headers, timeout=60) as client:
        for site, days in payloads:
            rows = _upsert(client, "/sites", "system_key", site)
            if len(rows) != 1 or not rows[0].get("id"):
                raise CuratedSeedError(f"{site['system_key']}: Supabase did not return a site ID")
            site_id = rows[0]["id"]
            _upsert(
                client,
                "/site_days",
                "site_id,observation_date",
                [{**day, "site_id": site_id} for day in days],
            )
            print(f"Seeded {site['system_key']}: 7 immutable days")

        sites_response = client.get("/sites", params={"curated": "eq.true", "select": "id,system_key"})
        if sites_response.status_code >= 400:
            raise CuratedSeedError("Could not verify curated sites")
        sites = sites_response.json()
        if len(sites) != 5:
            raise CuratedSeedError(f"Expected five stored curated sites, found {len(sites)}")
        site_ids = ",".join(row["id"] for row in sites)
        days_response = client.get(
            "/site_days",
            params={"site_id": f"in.({site_ids})", "select": "site_id,observation_date,immutable"},
        )
        if days_response.status_code >= 400:
            raise CuratedSeedError("Could not verify curated site days")
        stored_days = days_response.json()
        if len(stored_days) != 35 or not all(row["immutable"] for row in stored_days):
            raise CuratedSeedError("Stored curated day count or immutability check failed")
    print("PASS Supabase verification: 5 curated sites and 35 immutable site-days")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="Upsert the existing cache into Supabase")
    args = parser.parse_args()
    seed(args.execute)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
