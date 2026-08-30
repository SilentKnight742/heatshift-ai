"""A standard-library-only oracle for HeatShift's published methodology.

Nothing in this module imports or calls the production backend.  Keeping this
implementation independent makes agreement meaningful: the evaluator reads the
same public inputs and policy, then derives the expected result separately.
"""

from __future__ import annotations

import copy
import math
import statistics
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Iterable


Json = dict[str, Any]


def parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def retime_datetime(value: str | datetime, day: date) -> datetime:
    timestamp = parse_datetime(value)
    return timestamp.replace(year=day.year, month=day.month, day=day.day)


def retime_tasks(tasks: Iterable[Json], day: date) -> list[Json]:
    result: list[Json] = []
    for source in tasks:
        task = copy.deepcopy(source)
        for field in ("scheduled_start", "earliest_start", "latest_finish"):
            task[field] = retime_datetime(task[field], day)
        result.append(task)
    return result


def normalize_tasks(tasks: Iterable[Json]) -> list[Json]:
    """Copy JSON tasks and parse their three datetime fields."""

    result: list[Json] = []
    for source in tasks:
        task = copy.deepcopy(source)
        for field in ("scheduled_start", "earliest_start", "latest_finish"):
            task[field] = parse_datetime(task[field])
        result.append(task)
    return result


def _response_completed(response: Json, label: str) -> None:
    if response.get("error") is not False:
        raise ValueError(f"{label} response reports an error")
    if response.get("status_code") != 200:
        raise ValueError(f"{label} response status_code is not 200")
    if str(response.get("data", {}).get("status", "")).lower() not in {
        "completed",
        "succeeded",
    }:
        raise ValueError(f"{label} activity is not completed")


def _optional_float(value: Any) -> float | None:
    if value is None or value == -999:
        return None
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("environmental values must be finite")
    return number


def normalize_capture(capture: Json) -> Json:
    """Normalize either an evaluation capture or the paired main fixtures."""

    heatmap_response = capture["heatmap_response"]
    environment_response = capture["environment_response"]
    _response_completed(heatmap_response, "heatmap")
    _response_completed(environment_response, "environmental")

    heat_data = heatmap_response["data"]
    heat_result = heat_data["result"]
    env_data = environment_response["data"]
    env_result = env_data["result"]
    features = heat_result["map_data"].get("features", [])
    if not features:
        raise ValueError("heatmap contains no features")

    metadata = env_result["metadata"]
    timestamps = metadata.get("timestamps", [])
    locations = env_result.get("locations", [])
    if not timestamps or not locations:
        raise ValueError("environmental response contains no observations")
    location = locations[0]
    parameters = location.get("parameters", {})
    solar = location.get("solar_irradiance", {}).get("clear_sky", {})

    def item(name: str, index: int) -> float | None:
        values = parameters.get(name, [])
        value = values[index] if index < len(values) else None
        return _optional_float(value)

    observations = []
    for index, timestamp in enumerate(timestamps):
        observations.append(
            {
                "timestamp": parse_datetime(timestamp),
                "latitude": float(location["lat"]),
                "longitude": float(location["lon"]),
                "apparent_temperature_c": item(
                    "apparent_temperature_celsius", index
                ),
                "heat_index_c": item("heat_index_celsius", index),
                "wet_bulb_temperature_c": item(
                    "wet_bulb_temperature_celsius", index
                ),
                "relative_humidity_percent": item(
                    "relative_humidity_percent", index
                ),
                "solar_irradiance_ghi_wm2": _optional_float(solar.get("ghi")),
                "source": "FortyGuard environmental parameters",
                "activity_id": str(env_data["activity_id"]),
            }
        )

    return {
        "heatmap_geojson": heat_result["map_data"],
        "temperature_stats": heat_result["stats_data"]["temperature_stats"],
        "observations": observations,
        "heatmap_activity_id": str(heat_data["activity_id"]),
        "environmental_activity_id": str(env_data["activity_id"]),
        "metadata": metadata,
        "heatmap_request": capture["heatmap_request"],
        "environment_request": capture["environment_request"],
    }


def validate_heatmap(bundle: Json) -> list[str]:
    """Return all structural/statistical heatmap problems, if any."""

    errors: list[str] = []
    features = bundle["heatmap_geojson"].get("features", [])
    ids: set[str] = set()
    tile_ids: set[Any] = set()
    temperatures: list[float] = []
    for index, feature in enumerate(features):
        prefix = f"feature[{index}]"
        feature_id = str(feature.get("id"))
        if feature_id in ids:
            errors.append(f"{prefix} duplicates feature id {feature_id}")
        ids.add(feature_id)
        properties = feature.get("properties", {})
        tile_id = properties.get("tile_id")
        if tile_id in tile_ids:
            errors.append(f"{prefix} duplicates tile_id {tile_id}")
        tile_ids.add(tile_id)
        try:
            temperature = float(properties["average_temperature"])
        except (KeyError, TypeError, ValueError):
            errors.append(f"{prefix} has no numeric average_temperature")
        else:
            if not math.isfinite(temperature):
                errors.append(f"{prefix} temperature is not finite")
            temperatures.append(temperature)
            for name in ("min_temperature", "max_temperature"):
                try:
                    boundary = float(properties[name])
                except (KeyError, TypeError, ValueError):
                    errors.append(f"{prefix} has no numeric {name}")
                    continue
                if not math.isfinite(boundary):
                    errors.append(f"{prefix} {name} is not finite")
            if (
                isinstance(properties.get("min_temperature"), (int, float))
                and isinstance(properties.get("max_temperature"), (int, float))
                and not (
                    float(properties["min_temperature"])
                    <= temperature
                    <= float(properties["max_temperature"])
                )
            ):
                errors.append(f"{prefix} average lies outside its min/max")

        geometry = feature.get("geometry", {})
        if geometry.get("type") != "Polygon":
            errors.append(f"{prefix} is not a Polygon")
            continue
        rings = geometry.get("coordinates", [])
        if not rings or len(rings[0]) < 4 or rings[0][0] != rings[0][-1]:
            errors.append(f"{prefix} has no closed exterior ring")
            continue
        for point in rings[0]:
            if (
                not isinstance(point, list)
                or len(point) < 2
                or not all(isinstance(value, (int, float)) for value in point[:2])
            ):
                errors.append(f"{prefix} has an invalid coordinate")
                break
            longitude, latitude = point[:2]
            if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
                errors.append(f"{prefix} has an out-of-range coordinate")
                break

    if temperatures:
        stats = bundle["temperature_stats"]
        expected = {
            "minimum": min(temperatures),
            "maximum": max(temperatures),
            "mean": statistics.fmean(temperatures),
            # FortyGuard labels this field generically and returns the sample
            # standard deviation (n-1), not the population statistic.
            "standard_deviation": statistics.stdev(temperatures),
        }
        for key, value in expected.items():
            if not math.isclose(
                float(stats[key]), value, rel_tol=1e-12, abs_tol=1e-12
            ):
                errors.append(
                    f"temperature_stats.{key}={stats[key]} does not match cells ({value})"
                )
    return errors


def validate_environment(bundle: Json) -> list[str]:
    errors: list[str] = []
    observations = bundle["observations"]
    metadata = bundle["metadata"]
    declared_count = metadata.get("time_range", {}).get("count")
    if declared_count != len(observations):
        errors.append(
            f"metadata count {declared_count} does not match {len(observations)} observations"
        )
    timestamps = [item["timestamp"] for item in observations]
    if timestamps != sorted(timestamps) or len(timestamps) != len(set(timestamps)):
        errors.append("timestamps are not unique and chronological")
    for left, right in zip(timestamps, timestamps[1:]):
        if right - left != timedelta(hours=1):
            errors.append("observations are not exactly one hour apart")
            break
    time_range = metadata.get("time_range", {})
    if timestamps:
        try:
            range_start = parse_datetime(time_range["start"])
            range_end = parse_datetime(time_range["end"])
        except (KeyError, TypeError, ValueError, AttributeError):
            errors.append("metadata time range is missing or invalid")
        else:
            if range_start != timestamps[0] or range_end != timestamps[-1]:
                errors.append("metadata time range does not match the timestamp endpoints")
    for name in ("heatmap_activity_id", "environmental_activity_id"):
        try:
            uuid.UUID(str(bundle[name]))
        except (ValueError, AttributeError):
            errors.append(f"{name} is not a UUID")
    for index, observation in enumerate(observations):
        for field in (
            "apparent_temperature_c",
            "heat_index_c",
            "wet_bulb_temperature_c",
            "relative_humidity_percent",
            "solar_irradiance_ghi_wm2",
        ):
            if observation[field] is None:
                errors.append(f"observation[{index}] lacks {field}")
        if observation["activity_id"] != bundle["environmental_activity_id"]:
            errors.append(f"observation[{index}] has a mismatched activity id")
    return errors


def score_segment(
    task: Json,
    crew: Json,
    apparent_temperature_c: float | None,
    at_time: str | datetime,
    policy: Json,
) -> Json:
    """Apply the published additive policy to one task segment."""

    if apparent_temperature_c is None:
        raise ValueError("apparent temperature is required for screening risk")
    apparent = float(apparent_temperature_c)
    environmental_points: int | None = None
    for band in policy["environmental_apparent_temperature_bands_c"]:
        if band["max"] is None or apparent <= float(band["max"]):
            environmental_points = int(band["points"])
            break
    if environmental_points is None:
        raise ValueError("policy has no open-ended environmental band")

    factors = [
        {
            "name": "environmental_conditions",
            "points": environmental_points,
            "detail": f"Apparent temperature {apparent:.1f}°C",
        }
    ]
    adjustments = [
        (
            f"{task['workload']}_workload",
            int(policy["workload_adjustments"][task["workload"]]),
        ),
        (
            f"{crew['acclimatization_status']}_crew",
            int(
                policy["acclimatization_adjustments"]
                [crew["acclimatization_status"]]
            ),
        ),
        (
            f"{crew['ppe_level']}_ppe_burden",
            int(policy["ppe_adjustments"][crew["ppe_level"]]),
        ),
    ]
    timestamp = parse_datetime(at_time)
    start_hour, end_hour = policy["direct_solar_hours"]
    if task.get("shaded", False):
        adjustments.append(("shade_available", int(policy["shaded_adjustment"])))
    elif start_hour <= timestamp.hour < end_hour:
        adjustments.append(
            ("direct_solar_exposure", int(policy["direct_solar_adjustment"]))
        )
    for name, points in adjustments:
        if points:
            factors.append({"name": name, "points": points})

    unclamped = sum(item["points"] for item in factors)
    score = max(0, min(100, unclamped))
    risk_band = "critical"
    for band in policy["risk_bands"]:
        if score <= int(band["max"]):
            risk_band = str(band["name"])
            break
    return {
        "score": score,
        "unclamped_score": unclamped,
        "band": risk_band,
        "factors": [{"name": item["name"], "points": item["points"]} for item in factors],
    }


def _nearest_observation(timestamp: datetime, observations: list[Json]) -> Json:
    if not observations:
        raise ValueError("at least one environmental observation is required")
    # An explicit chronological tie-break avoids depending on source array order.
    return min(
        observations,
        key=lambda observation: (
            abs(parse_datetime(observation["timestamp"]) - timestamp),
            parse_datetime(observation["timestamp"]),
        ),
    )


def task_end(task: Json) -> datetime:
    return parse_datetime(task["scheduled_start"]) + timedelta(
        minutes=int(task["duration_minutes"])
    )


def assess_task(task: Json, crew: Json, observations: list[Json], policy: Json) -> Json:
    slot_minutes = int(policy["slot_minutes"])
    remaining = int(task["duration_minutes"])
    cursor = parse_datetime(task["scheduled_start"])
    weighted_score = 0.0
    exposed_worker_minutes = 0
    peak: Json | None = None
    segments: list[Json] = []
    while remaining > 0:
        minutes = min(slot_minutes, remaining)
        observation = _nearest_observation(cursor, observations)
        reading = score_segment(
            task,
            crew,
            observation["apparent_temperature_c"],
            cursor,
            policy,
        )
        weighted_score += reading["score"] * minutes
        if reading["score"] >= int(policy["high_risk_threshold"]):
            exposed_worker_minutes += minutes * int(crew["worker_count"])
        if peak is None or reading["score"] > peak["score"]:
            peak = reading
        segments.append(
            {
                "start": cursor,
                "minutes": minutes,
                "observation_timestamp": parse_datetime(observation["timestamp"]),
                **reading,
            }
        )
        cursor += timedelta(minutes=minutes)
        remaining -= minutes
    assert peak is not None
    return {
        "task_id": task["task_id"],
        "task_name": task["name"],
        "crew_id": crew["crew_id"],
        "crew_name": crew["name"],
        "worker_count": int(crew["worker_count"]),
        "workload": task["workload"],
        "start": parse_datetime(task["scheduled_start"]),
        "end": task_end(task),
        "movable": bool(task["movable"]),
        "shaded": bool(task.get("shaded", False)),
        "average_risk": round(weighted_score / int(task["duration_minutes"]), 1),
        "peak_risk": int(peak["score"]),
        "peak_band": peak["band"],
        "exposed_worker_minutes": exposed_worker_minutes,
        "risk_factors": peak["factors"],
        "segments": segments,
    }


def assess_schedule(
    tasks: Iterable[Json], crews: Iterable[Json], observations: list[Json], policy: Json
) -> list[Json]:
    crew_by_id = {crew["crew_id"]: crew for crew in crews}
    return sorted(
        [
            assess_task(task, crew_by_id[task["crew_id"]], observations, policy)
            for task in tasks
        ],
        key=lambda item: item["start"],
    )


def _overlap(left: Json, right: Json) -> bool:
    return (
        parse_datetime(left["scheduled_start"]) < task_end(right)
        and parse_datetime(right["scheduled_start"]) < task_end(left)
    )


def _candidate_valid(candidate: Json, schedule: dict[str, Json]) -> bool:
    for other in schedule.values():
        if other["task_id"] == candidate["task_id"]:
            continue
        if other["crew_id"] == candidate["crew_id"] and _overlap(candidate, other):
            return False
    for dependency_id in candidate.get("dependencies", []):
        if parse_datetime(candidate["scheduled_start"]) < task_end(schedule[dependency_id]):
            return False
    for dependent in schedule.values():
        if (
            candidate["task_id"] in dependent.get("dependencies", [])
            and task_end(candidate) > parse_datetime(dependent["scheduled_start"])
        ):
            return False
    return True


def _objective(
    assessment: Json, original_start: datetime, policy: Json
) -> float:
    duration = (assessment["end"] - assessment["start"]).total_seconds() / 60
    disruption = abs((assessment["start"] - original_start).total_seconds()) / 60
    return (
        assessment["average_risk"] * duration * assessment["worker_count"]
        + disruption * float(policy["disruption_penalty_per_minute"])
    )


def optimize_greedy(
    tasks: Iterable[Json], crews: Iterable[Json], observations: list[Json], policy: Json
) -> tuple[list[Json], list[Json], list[Json]]:
    """Independently implement the scheduler exactly as publicly documented."""

    tasks = list(tasks)
    crew_by_id = {crew["crew_id"]: crew for crew in crews}
    schedule = {task["task_id"]: copy.deepcopy(task) for task in tasks}
    rank = {"very_heavy": 4, "heavy": 3, "moderate": 2, "light": 1}
    movable = sorted(
        [task for task in tasks if task["movable"]],
        key=lambda task: (-rank[task["workload"]], parse_datetime(task["scheduled_start"])),
    )
    movements: list[Json] = []
    step = timedelta(minutes=int(policy["slot_minutes"]))
    for original in movable:
        original_start = parse_datetime(original["scheduled_start"])
        best = schedule[original["task_id"]]
        best_assessment = assess_task(
            best, crew_by_id[best["crew_id"]], observations, policy
        )
        best_objective = _objective(best_assessment, original_start, policy)
        cursor = parse_datetime(original["earliest_start"])
        duration = timedelta(minutes=int(original["duration_minutes"]))
        latest_finish = parse_datetime(original["latest_finish"])
        while cursor + duration <= latest_finish:
            candidate = copy.deepcopy(original)
            candidate["scheduled_start"] = cursor
            if _candidate_valid(candidate, schedule):
                assessment = assess_task(
                    candidate,
                    crew_by_id[candidate["crew_id"]],
                    observations,
                    policy,
                )
                objective = _objective(assessment, original_start, policy)
                if objective < best_objective:
                    best = candidate
                    best_assessment = assessment
                    best_objective = objective
            cursor += step
        schedule[original["task_id"]] = best
        if parse_datetime(best["scheduled_start"]) != original_start:
            movements.append(
                {
                    "task_id": original["task_id"],
                    "task_name": original["name"],
                    "from_start": original_start,
                    "to_start": parse_datetime(best["scheduled_start"]),
                    "minutes_moved": int(
                        abs(
                            (
                                parse_datetime(best["scheduled_start"])
                                - original_start
                            ).total_seconds()
                        )
                        // 60
                    ),
                    "peak_before": assess_task(
                        original,
                        crew_by_id[original["crew_id"]],
                        observations,
                        policy,
                    )["peak_risk"],
                    "peak_after": best_assessment["peak_risk"],
                    "objective": best_objective,
                }
            )
    optimized_tasks = sorted(
        schedule.values(), key=lambda task: parse_datetime(task["scheduled_start"])
    )
    return (
        optimized_tasks,
        assess_schedule(optimized_tasks, crew_by_id.values(), observations, policy),
        movements,
    )


def validate_schedule(
    original_tasks: Iterable[Json], optimized_tasks: Iterable[Json]
) -> list[str]:
    """Check every advertised constraint without trusting backend validation."""

    errors: list[str] = []
    originals = {task["task_id"]: task for task in original_tasks}
    optimized = {task["task_id"]: task for task in optimized_tasks}
    if set(originals) != set(optimized):
        missing = sorted(set(originals) - set(optimized))
        added = sorted(set(optimized) - set(originals))
        errors.append(f"task identity changed (missing={missing}, added={added})")
        return errors
    immutable = ("crew_id", "duration_minutes", "workload", "dependencies", "movable")
    for task_id, original in originals.items():
        revised = optimized[task_id]
        for field in immutable:
            if revised.get(field) != original.get(field):
                errors.append(f"{task_id} changed {field}")
        revised_start = parse_datetime(revised["scheduled_start"])
        if not original["movable"] and revised_start != parse_datetime(
            original["scheduled_start"]
        ):
            errors.append(f"fixed task {task_id} moved")
        if revised_start < parse_datetime(original["earliest_start"]):
            errors.append(f"{task_id} begins before earliest_start")
        if task_end(revised) > parse_datetime(original["latest_finish"]):
            errors.append(f"{task_id} ends after latest_finish")
        for dependency_id in revised.get("dependencies", []):
            if revised_start < task_end(optimized[dependency_id]):
                errors.append(f"{task_id} violates dependency {dependency_id}")
    rows = list(optimized.values())
    for index, left in enumerate(rows):
        for right in rows[index + 1 :]:
            if left["crew_id"] == right["crew_id"] and _overlap(left, right):
                errors.append(
                    f"crew {left['crew_id']} overlaps {left['task_id']} and {right['task_id']}"
                )
    return errors


def calculate_metrics(
    temperature_stats: Json,
    observations: list[Json],
    baseline: list[Json],
    optimized: list[Json],
    movements: list[Json],
) -> Json:
    baseline_exposure = sum(item["exposed_worker_minutes"] for item in baseline)
    optimized_exposure = sum(item["exposed_worker_minutes"] for item in optimized)
    reduction = (
        (baseline_exposure - optimized_exposure) / baseline_exposure * 100
        if baseline_exposure
        else 0.0
    )
    highest = max(baseline, key=lambda item: item["peak_risk"])
    apparent = [
        item["apparent_temperature_c"]
        for item in observations
        if item["apparent_temperature_c"] is not None
    ]
    return {
        "peak_temperature_c": round(float(temperature_stats["maximum"]), 1),
        "peak_apparent_temperature_c": round(max(apparent), 1),
        "maximum_screening_score": highest["peak_risk"],
        "highest_risk_task": highest["task_name"],
        "baseline_exposed_worker_minutes": baseline_exposure,
        "optimized_exposed_worker_minutes": optimized_exposure,
        "exposure_reduction_percent": round(reduction, 1),
        "schedule_disruption_minutes": sum(
            movement["minutes_moved"] for movement in movements
        ),
        "productivity_retained_percent": 100.0,
        "tasks_moved": len(movements),
    }


def canonical_schedule_projection(schedule: Iterable[Json]) -> list[Json]:
    """Return just the deterministic, externally comparable schedule fields."""

    fields = (
        "task_id",
        "crew_id",
        "worker_count",
        "start",
        "end",
        "average_risk",
        "peak_risk",
        "peak_band",
        "exposed_worker_minutes",
    )
    projected = []
    for item in schedule:
        row = {field: item[field] for field in fields}
        row["start"] = parse_datetime(row["start"]).isoformat()
        row["end"] = parse_datetime(row["end"]).isoformat()
        projected.append(row)
    return sorted(projected, key=lambda row: row["task_id"])
