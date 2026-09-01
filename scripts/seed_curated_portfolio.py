#!/usr/bin/env python3
"""Acquire the five curated FortyGuard site-weeks with resumable checkpoints.

This command is intentionally excluded from CI. It performs paid provider calls
only when --execute is supplied, checks the documented reserve first, and never
repeats a completed activity saved in its checkpoint.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.clients.fortyguard import FortyGuardClient  # noqa: E402
from app.models.site import GeoPoint  # noqa: E402
from app.services.portfolio import CURATED_SITES  # noqa: E402
from app.services.provisioning import _normalize_days, _remaining_credits  # noqa: E402
from app.services.state_catalog import circle_feature_collection  # noqa: E402


WEEK_START = date(2024, 7, 15)
ESTIMATE_PER_SITE = int(os.getenv("FORTYGUARD_SITE_WEEK_ESTIMATE", "64240"))
RESERVE = int(os.getenv("FORTYGUARD_CREDIT_RESERVE", "200000"))


def write_checkpoint(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.replace(path)


async def complete(client: FortyGuardClient, activity_id: str) -> dict:
    return await client.wait_for_activity(activity_id, max_attempts=120, initial_delay=2)


async def seed_site(client: FortyGuardClient, config: dict, execute: bool, retry_stuck: bool = False) -> None:
    output_dir = ROOT / "data" / "curated" / config["site_id"]
    checkpoint_path = output_dir / ".acquisition-checkpoint.json"
    output_path = output_dir / "week-2024-07-15.json"
    geometry = circle_feature_collection(config["longitude"], config["latitude"], 600)
    state = json.loads(checkpoint_path.read_text()) if checkpoint_path.exists() else {
        "site_id": config["site_id"],
        "week_start": WEEK_START.isoformat(),
        "geometry": geometry,
        "days": {},
        "satellite": {},
    }
    if output_path.exists():
        print(f"{config['site_id']}: already complete")
        return
    if not execute:
        print(f"{config['site_id']}: would acquire 7 heatmaps, 7 environmental days and 1 satellite segmentation")
        return

    for offset in range(7):
        current = WEEK_START + timedelta(days=offset)
        day_key = current.isoformat()
        item = state["days"].setdefault(day_key, {})
        heat_time = {"start_date": day_key, "start_time": "15:00", "filter_type": 1}
        if "heatmap_id" not in item:
            item["heatmap_id"] = await client.submit_heatmap(geometry, heat_time, 100)
            write_checkpoint(checkpoint_path, state)
            print(f"{config['site_id']} {day_key}: heatmap submitted {item['heatmap_id']}")
        if "heatmap_result" not in item:
            item["heatmap_result"] = await complete(client, item["heatmap_id"])
            features = item["heatmap_result"].get("data", {}).get("result", {}).get("map_data", {}).get("features", [])
            if not features:
                raise RuntimeError(f"{config['site_id']} {day_key}: completed heatmap had no cells")
            write_checkpoint(checkpoint_path, state)
            print(f"{config['site_id']} {day_key}: heatmap complete ({len(features)} cells)")
        mean = item["heatmap_result"]["data"]["result"]["stats_data"]["temperature_stats"]["mean"]
        env_time = {"start_date": day_key, "start_time": "00:00", "end_time": "23:00", "filter_type": 2}
        if "environment_id" not in item:
            item["environment_id"] = await client.submit_environmental_parameters(
                config["latitude"], config["longitude"], mean, env_time
            )
            write_checkpoint(checkpoint_path, state)
            print(f"{config['site_id']} {day_key}: environment submitted {item['environment_id']}")
        elif retry_stuck and "environment_result" not in item and not item.get("abandoned_environment_activity_ids"):
            status = await client.get_activity_status(item["environment_id"])
            if str(status.get("data", {}).get("status", "")).lower() == "processing":
                abandoned = item.setdefault("abandoned_environment_activity_ids", [])
                abandoned.append(item.pop("environment_id"))
                write_checkpoint(checkpoint_path, state)
                item["environment_id"] = await client.submit_environmental_parameters(
                    config["latitude"], config["longitude"], mean, env_time
                )
                write_checkpoint(checkpoint_path, state)
                print(f"{config['site_id']} {day_key}: replaced one stuck environmental activity with {item['environment_id']}")
        if "environment_result" not in item:
            item["environment_result"] = await complete(client, item["environment_id"])
            locations = item["environment_result"].get("data", {}).get("result", {}).get("locations", [])
            if not locations:
                raise RuntimeError(f"{config['site_id']} {day_key}: environmental result had no locations")
            write_checkpoint(checkpoint_path, state)
            print(f"{config['site_id']} {day_key}: environment complete")

    if "activity_id" not in state["satellite"]:
        state["satellite"]["activity_id"] = await client.submit_satellite_segmentation(
            config["latitude"], config["longitude"],
            {"start_date": WEEK_START.isoformat(), "start_time": "15:00", "filter_type": 1}, 100,
        )
        write_checkpoint(checkpoint_path, state)
        print(f"{config['site_id']}: satellite submitted {state['satellite']['activity_id']}")
    if "result" not in state["satellite"]:
        state["satellite"]["result"] = await complete(client, state["satellite"]["activity_id"])
        write_checkpoint(checkpoint_path, state)
        print(f"{config['site_id']}: satellite complete")

    record = SimpleNamespace(site=SimpleNamespace(
        centroid=GeoPoint(longitude=config["longitude"], latitude=config["latitude"])
    ))
    normalized_state = {"days": state["days"], "satellite": state["satellite"]}
    days = _normalize_days(record, normalized_state)
    payload = {
        "schema_version": 1,
        "site": {key: value for key, value in config.items() if key != "temperature_peak"},
        "week_start": WEEK_START.isoformat(),
        "data_classification": {
            "environment": "real cached FortyGuard responses",
            "operation": "fictional HeatShift scenario",
            "hourly_cells": "HeatShift-derived interpolation from daily 15:00 cells",
        },
        "activity_ids": {
            "heatmaps": [state["days"][key]["heatmap_id"] for key in sorted(state["days"])],
            "environmental": [state["days"][key]["environment_id"] for key in sorted(state["days"])],
            "satellite": state["satellite"]["activity_id"],
        },
        "abandoned_activity_ids": {
            "environmental": [
                activity_id
                for key in sorted(state["days"])
                for activity_id in state["days"][key].get("abandoned_environment_activity_ids", [])
            ],
        },
        "days": [day.model_dump(mode="json") for day in days],
    }
    write_checkpoint(output_path, payload)
    print(f"{config['site_id']}: wrote {output_path}")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="Perform credit-consuming provider requests")
    parser.add_argument("--site", action="append", choices=[item["site_id"] for item in CURATED_SITES])
    parser.add_argument(
        "--retry-stuck",
        action="store_true",
        help="Replace one still-processing environmental activity while preserving its prior ID in the checkpoint",
    )
    args = parser.parse_args()
    selected = [item for item in CURATED_SITES if not args.site or item["site_id"] in args.site]
    client = FortyGuardClient()
    if args.execute:
        if not client.configured:
            parser.error("FORTYGUARD_API_KEY is required with --execute")
        usage = await client.get_credit_usage()
        remaining = _remaining_credits(usage)
        if remaining is None:
            raise RuntimeError("Provider usage could not be verified; no paid calls were submitted")
        required = len(selected) * ESTIMATE_PER_SITE
        print(f"Verified {remaining:,} remaining credits; estimated acquisition {required:,}; reserve {RESERVE:,}.")
        if remaining - required < RESERVE:
            raise RuntimeError("Acquisition would breach the configured credit reserve")
    for config in selected:
        await seed_site(client, config, args.execute, args.retry_stuck)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
