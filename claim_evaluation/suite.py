"""Claim-oriented audits for repository fixtures and public API responses."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .oracle import (
    assess_schedule,
    calculate_metrics,
    canonical_schedule_projection,
    derive_heatshield_benchmark,
    load_heatshield_trials,
    normalize_capture,
    normalize_tasks,
    optimize_greedy,
    parse_datetime,
    retime_tasks,
    validate_environment,
    validate_heatmap,
    validate_schedule,
)


Json = dict[str, Any]
EXPECTED_TOOLS = [
    "get_site_heat",
    "load_shift_plan",
    "calculate_exposure_risk",
    "optimize_shift",
    "get_policy_guidance",
    "create_worker_alerts",
]
EXPECTED_NIOSH_LINKS = {
    "https://www.cdc.gov/niosh/heat-stress/recommendations/index.html",
    "https://www.cdc.gov/niosh/heat-stress/recommendations/acclimatization.html",
}
EXPECTED_HEATSHIELD_SUMMARY = {
    "pearson_r": 0.7744,
    "spearman_rho": 0.7718,
    "below_records": 248,
    "below_mean": 14.37,
    "high_records": 318,
    "high_mean": 50.82,
    "mean_difference": 36.45,
}
EXPECTED_HEATSHIELD_BANDS = [
    ("moderate", 248, 26, 48, 14.37, 11.52, 0.0, 23.18),
    ("high", 201, 50, 73, 47.18, 44.2, 32.08, 67.05),
    ("critical", 117, 79, 89, 57.07, 59.04, 43.72, 72.77),
]
EXPECTED_HEATSHIELD_INDICES = {
    "apparent_temperature": {"pearson_r": 0.8425, "spearman_rho": 0.8688},
    "heat_index": {"pearson_r": 0.8612, "spearman_rho": 0.8516},
    "wbgt_outdoor": {"pearson_r": 0.8263, "spearman_rho": 0.8838},
    "utci": {"pearson_r": 0.8583, "spearman_rho": 0.8732},
}


@dataclass(frozen=True)
class Check:
    check_id: str
    category: str
    status: str
    claim: str
    evidence: str


class ClaimAudit:
    def __init__(self) -> None:
        self.checks: list[Check] = []

    def record(
        self,
        check_id: str,
        category: str,
        passed: bool,
        claim: str,
        evidence: str,
    ) -> None:
        self.checks.append(
            Check(
                check_id=check_id,
                category=category,
                status="PASS" if passed else "FAIL",
                claim=claim,
                evidence=evidence,
            )
        )

    def unverified(
        self, check_id: str, category: str, claim: str, evidence: str
    ) -> None:
        self.checks.append(
            Check(check_id, category, "UNVERIFIED", claim, evidence)
        )

    def info(self, check_id: str, category: str, claim: str, evidence: str) -> None:
        self.checks.append(Check(check_id, category, "INFO", claim, evidence))

    @property
    def failed(self) -> list[Check]:
        return [check for check in self.checks if check.status == "FAIL"]

    def report(self) -> Json:
        counts = {
            status: sum(check.status == status for check in self.checks)
            for status in ("PASS", "FAIL", "UNVERIFIED", "INFO")
        }
        return {
            "status": "failed" if counts["FAIL"] else "passed_with_caveats",
            "counts": counts,
            "checks": [asdict(check) for check in self.checks],
        }


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _main_capture(root: Path) -> Json:
    heat = _load_json(root / "data/cache/fortyguard_demo_response.json")
    environment = _load_json(
        root / "data/cache/fortyguard_environment_response.json"
    )
    return {
        "captured_at": min(heat["captured_at"], environment["captured_at"]),
        "heatmap_request": heat["request"],
        "heatmap_response": heat["response"],
        "environment_request": environment["request"],
        "environment_response": environment["response"],
    }


def load_captures(root: Path) -> list[tuple[str, Json]]:
    return [
        (
            "2026-08-25",
            _load_json(root / "data/cache/evaluation_2026-08-25.json"),
        ),
        (
            "2026-08-27",
            _load_json(root / "data/cache/evaluation_2026-08-27.json"),
        ),
        ("2026-08-28", _main_capture(root)),
    ]


def _movement_projection(movements: list[Json]) -> list[Json]:
    result = []
    for movement in movements:
        result.append(
            {
                "task_id": movement["task_id"],
                "from_start": parse_datetime(movement["from_start"]).isoformat(),
                "to_start": parse_datetime(movement["to_start"]).isoformat(),
                "minutes_moved": int(movement["minutes_moved"]),
            }
        )
    return sorted(result, key=lambda item: item["task_id"])


def _factor_projection(schedule: list[Json]) -> dict[str, list[tuple[str, int]]]:
    return {
        item["task_id"]: sorted(
            (factor["name"], int(factor["points"]))
            for factor in item["risk_factors"]
        )
        for item in schedule
    }


def _derive_replay(
    day_text: str, capture: Json, shift: Json, crews: list[Json], policy: Json
) -> Json:
    bundle = normalize_capture(capture)
    tasks = retime_tasks(shift["tasks"], date.fromisoformat(day_text))
    baseline = assess_schedule(tasks, crews, bundle["observations"], policy)
    optimized_tasks, optimized, movements = optimize_greedy(
        tasks, crews, bundle["observations"], policy
    )
    metrics = calculate_metrics(
        bundle["temperature_stats"],
        bundle["observations"],
        baseline,
        optimized,
        movements,
    )
    return {
        "bundle": bundle,
        "tasks": tasks,
        "baseline": baseline,
        "optimized_tasks": optimized_tasks,
        "optimized": optimized,
        "movements": movements,
        "metrics": metrics,
    }


def _audit_heatshield_repository(
    audit: ClaimAudit, root: Path, policy: Json
) -> Json | None:
    data_path = root / "data/validation/heatshield_trials.csv"
    provenance_path = root / "data/validation/heatshield_provenance.json"
    try:
        provenance = _load_json(provenance_path)
        rows = load_heatshield_trials(data_path)
        benchmark = derive_heatshield_benchmark(rows, policy)
    except (OSError, KeyError, TypeError, ValueError) as exc:
        audit.record(
            "HSHIELD-EVID",
            "empirical_validation",
            False,
            "The HEAT-SHIELD slice is parseable, integrity-bound, and traceable.",
            f"{type(exc).__name__}: {exc}",
        )
        return None

    actual_sha = hashlib.sha256(data_path.read_bytes()).hexdigest()
    derived = provenance.get("derived_slice", {})
    dataset = provenance.get("dataset", {})
    source_file = provenance.get("source_file", {})
    evidence_ok = (
        benchmark["records"] == derived.get("records") == 566
        and benchmark["participants"]
        == derived.get("pseudonymous_participants")
        == 32
        and benchmark["study_ids"] == derived.get("source_study_ids") == list(range(1, 7))
        and actual_sha == derived.get("sha256")
        == "f80db381ab856b5720a84f27090c9b7988ff17bf29998f800b73458b8f1113d9"
        and dataset.get("doi") == "10.6084/m9.figshare.25722300.v1"
        and dataset.get("license", {}).get("identifier") == "CC BY 4.0"
        and source_file.get("md5") == "e36962603afbdbd6e9856936aacab62f"
    )
    audit.record(
        "HSHIELD-EVID",
        "empirical_validation",
        evidence_ok,
        "The HEAT-SHIELD slice is parseable, integrity-bound, licensed, and traceable.",
        (
            f"records={benchmark['records']}; participants={benchmark['participants']}; "
            f"studies={benchmark['study_ids']}; sha256={actual_sha}; "
            f"license={dataset.get('license', {}).get('identifier')}"
        ),
    )

    metrics = benchmark["metrics"]
    score = metrics["score_vs_measured_pwc_loss"]
    below = metrics["below_high_risk_threshold"]
    high = metrics["at_or_above_high_risk_threshold"]
    summary = {
        "pearson_r": score["pearson_r"],
        "spearman_rho": score["spearman_rho"],
        "below_records": below["records"],
        "below_mean": below["mean_measured_pwc_loss_percent"],
        "high_records": high["records"],
        "high_mean": high["mean_measured_pwc_loss_percent"],
        "mean_difference": metrics["mean_loss_difference_percentage_points"],
    }
    audit.record(
        "HSHIELD-CALC",
        "empirical_validation",
        summary == EXPECTED_HEATSHIELD_SUMMARY,
        "An independent oracle reproduces the published score correlation and threshold-group result.",
        f"derived={_canonical(summary)}; published={_canonical(EXPECTED_HEATSHIELD_SUMMARY)}",
    )

    band_projection = [
        (
            row["band"],
            row["records"],
            row["score_minimum"],
            row["score_maximum"],
            row["mean_measured_pwc_loss_percent"],
            row["median_measured_pwc_loss_percent"],
            row["p25_measured_pwc_loss_percent"],
            row["p75_measured_pwc_loss_percent"],
        )
        for row in metrics["bands"]
    ]
    audit.record(
        "HSHIELD-BANDS",
        "empirical_validation",
        band_projection == EXPECTED_HEATSHIELD_BANDS
        and sum(row[1] for row in band_projection) == 566,
        "The moderate, high, and critical band summaries are independently reproducible and exhaustive.",
        f"bands={_canonical(band_projection)}",
    )

    ranges = metrics["input_ranges"]
    ranges_ok = (
        ranges["air_temperature"] == {
            "minimum": 14.311,
            "maximum": 50.786,
            "unit": "degC",
        }
        and ranges["measured_pwc_loss"] == {
            "minimum": 0.0,
            "maximum": 93.581,
            "unit": "percent",
        }
    )
    audit.record(
        "HSHIELD-INDICES",
        "empirical_validation",
        metrics["comparative_index_correlations"] == EXPECTED_HEATSHIELD_INDICES
        and ranges_ok,
        "The comparative heat-index correlations and published input/outcome ranges are independently reproducible.",
        (
            f"indices={_canonical(metrics['comparative_index_correlations'])}; "
            f"air_temperature={_canonical(ranges['air_temperature'])}; "
            f"pwc_loss={_canonical(ranges['measured_pwc_loss'])}"
        ),
    )

    limitations = "\n".join(provenance.get("limitations", [])).lower()
    scope_ok = all(
        phrase in limitations
        for phrase in (
            "controlled environmental-chamber",
            "not heat illness",
            "not statistically independent",
            "does not fit or tune",
        )
    )
    audit.record(
        "HSHIELD-SCOPE",
        "scope",
        scope_ok,
        "The empirical claim discloses controlled trials, repeated measures, an outcome boundary, and no policy fitting.",
        f"required scope statements present={scope_ok}",
    )
    return benchmark


def audit_repository(root: Path, verify_provider: bool = False) -> ClaimAudit:
    root = root.resolve()
    audit = ClaimAudit()
    manifest = _load_json(
        root / "claim_evaluation/evidence_manifest.json"
    )["sha256"]
    mismatches = []
    for relative_path, expected in manifest.items():
        actual = hashlib.sha256((root / relative_path).read_bytes()).hexdigest()
        if actual != expected:
            mismatches.append(f"{relative_path}: expected {expected}, got {actual}")
    audit.record(
        "EVID-01",
        "evidence",
        not mismatches,
        "The evaluator ran against the pinned policy, scenario, and response files.",
        "; ".join(mismatches) if mismatches else f"{len(manifest)} SHA-256 pins match",
    )

    shift = _load_json(root / "data/demo/shift.json")
    crews = _load_json(root / "data/demo/crews.json")
    policy = _load_json(root / "data/demo/policy_rules.json")
    _audit_heatshield_repository(audit, root, policy)
    published = _load_json(root / "data/evaluation_results.json")
    published_by_date = {row["date"]: row for row in published["scenarios"]}
    derived_rows: list[Json] = []
    activity_ids: set[str] = set()
    apparent_series: set[tuple[float | None, ...]] = set()
    captures = load_captures(root)

    for day_text, capture in captures:
        prefix = day_text.replace("-", "")
        try:
            replay = _derive_replay(day_text, capture, shift, crews, policy)
        except Exception as exc:
            audit.record(
                f"EVID-{prefix}",
                "evidence",
                False,
                f"The {day_text} saved responses are usable completed activities.",
                str(exc),
            )
            continue

        bundle = replay["bundle"]
        heat_errors = validate_heatmap(bundle)
        env_errors = validate_environment(bundle)
        audit.record(
            f"HEAT-{prefix}",
            "evidence",
            not heat_errors and len(bundle["heatmap_geojson"]["features"]) == 198,
            f"The {day_text} heatmap contains 198 valid cells and self-consistent statistics.",
            "; ".join(heat_errors)
            if heat_errors
            else "198 unique, closed polygons; min/max/mean/sample SD recomputed",
        )
        audit.record(
            f"ENV-{prefix}",
            "evidence",
            not env_errors and len(bundle["observations"]) == 11,
            f"The {day_text} environmental payload contains 11 usable hourly observations.",
            "; ".join(env_errors)
            if env_errors
            else "11 unique hourly timestamps with usable apparent temperatures",
        )
        env_input = float(bundle["environment_request"]["temperature"])
        heat_mean = float(bundle["temperature_stats"]["mean"])
        request_consistent = (
            bundle["heatmap_request"]["date_time"]["start_date"] == day_text
            and bundle["environment_request"]["date_time"]["start_date"]
            == day_text
            and math.isclose(env_input, heat_mean, rel_tol=0, abs_tol=1e-12)
            and bundle["heatmap_request"].get("granularity") == 100
        )
        audit.record(
            f"CHAIN-{prefix}",
            "evidence",
            request_consistent,
            "The environmental request is chained to the same-day 100 m heatmap mean.",
            f"environment input={env_input}; heatmap mean={heat_mean}",
        )

        schedule_errors = validate_schedule(
            replay["tasks"], replay["optimized_tasks"]
        )
        audit.record(
            f"SCHED-{prefix}",
            "constraints",
            not schedule_errors,
            f"The {day_text} optimized plan preserves every advertised constraint.",
            "; ".join(schedule_errors)
            if schedule_errors
            else "task set, crew, duration, windows, fixed work, dependencies, and overlaps checked",
        )

        row = {
            "date": day_text,
            "heatmap_activity_id": bundle["heatmap_activity_id"],
            "environmental_activity_id": bundle["environmental_activity_id"],
            "heatmap_cells": len(bundle["heatmap_geojson"]["features"]),
            "hourly_observations": len(bundle["observations"]),
            **replay["metrics"],
        }
        derived_rows.append(row)
        published_row = published_by_date.get(day_text, {})
        comparable_published = {key: published_row.get(key) for key in row}
        audit.record(
            f"CALC-{prefix}",
            "calculation",
            comparable_published == row,
            f"An independent oracle reproduces every published {day_text} metric.",
            f"derived={_canonical(row)}; published={_canonical(comparable_published)}",
        )
        expected_starts = {
            "heavy-cargo-loading": "06:00" if day_text == "2026-08-25" else "06:30",
            "asphalt-repair": "07:30" if day_text != "2026-08-25" else "07:00",
        }
        actual_starts = {
            task["task_id"]: parse_datetime(task["scheduled_start"]).strftime("%H:%M")
            for task in replay["optimized_tasks"]
            if task["task_id"] in expected_starts
        }
        audit.record(
            f"OPT-{prefix}",
            "optimization",
            actual_starts == expected_starts,
            "The documented greedy enumeration selects the published task starts.",
            f"starts={actual_starts}",
        )
        activity_ids.update(
            {bundle["heatmap_activity_id"], bundle["environmental_activity_id"]}
        )
        apparent_series.add(
            tuple(item["apparent_temperature_c"] for item in bundle["observations"])
        )

    audit.record(
        "EVID-05",
        "evidence",
        len(activity_ids) == 6 and len(apparent_series) == 3,
        "The evaluation contains three distinct response pairs, not duplicated payloads.",
        f"unique activity IDs={len(activity_ids)}; unique apparent-temperature series={len(apparent_series)}",
    )
    baseline_total = sum(row["baseline_exposed_worker_minutes"] for row in derived_rows)
    optimized_total = sum(row["optimized_exposed_worker_minutes"] for row in derived_rows)
    reduction = (
        round((baseline_total - optimized_total) / baseline_total * 100, 1)
        if baseline_total
        else 0.0
    )
    aggregate = published["aggregate"]
    aggregate_matches = (
        len(derived_rows) == 3
        and baseline_total == aggregate["baseline_exposed_worker_minutes"] == 3690
        and optimized_total == aggregate["optimized_exposed_worker_minutes"] == 810
        and reduction == aggregate["exposure_reduction_percent"] == 78.0
    )
    audit.record(
        "CALC-AGG",
        "calculation",
        aggregate_matches,
        "The headline 3,690 to 810 (78.0%) claim is arithmetically reproducible.",
        f"independent totals={baseline_total} to {optimized_total} ({reduction}%)",
    )

    # Report how conditional the headline is without treating a documented
    # product threshold as a defect.
    if derived_rows:
        sensitivity: dict[str, str] = {}
        main_bundle = _derive_replay("2026-08-28", captures[-1][1], shift, crews, policy)
        for threshold in (40, 45, 50, 55, 60, 70, 80):
            varied = dict(policy)
            varied["high_risk_threshold"] = threshold
            tasks = retime_tasks(shift["tasks"], date.fromisoformat("2026-08-28"))
            baseline = assess_schedule(tasks, crews, main_bundle["bundle"]["observations"], varied)
            _, optimized, _ = optimize_greedy(
                tasks, crews, main_bundle["bundle"]["observations"], varied
            )
            before = sum(row["exposed_worker_minutes"] for row in baseline)
            after = sum(row["exposed_worker_minutes"] for row in optimized)
            value = round((before - after) / before * 100, 1) if before else 0.0
            sensitivity[str(threshold)] = f"{before}->{after} ({value}%)"
        audit.info(
            "SENS-01",
            "scope",
            "The 78.0% headline is conditional on the product-defined threshold of 50.",
            _canonical(sensitivity),
        )

    if verify_provider:
        _audit_provider_authenticity(audit, captures)
    else:
        audit.unverified(
            "PROV-EXT",
            "provenance",
            "The checked-in payloads are authentic historical FortyGuard outputs.",
            (
                "Internal structure, distinct UUIDs, response status, and arithmetic "
                "are consistent, but repository files are not provider-signed. Run "
                "with --verify-provider and FORTYGUARD_API_KEY to re-fetch all six "
                "activity IDs read-only."
            ),
        )
    return audit


def _request_json(
    url: str,
    method: str = "GET",
    payload: Json | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 150,
) -> tuple[int, dict[str, str], Any, float]:
    body = json.dumps(payload).encode() if payload is not None else None
    request_headers = {"accept": "application/json", **(headers or {})}
    if body is not None:
        request_headers["content-type"] = "application/json"
    request = urllib.request.Request(
        url, data=body, headers=request_headers, method=method
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            status = response.status
            response_headers = {
                key.lower(): value for key, value in response.headers.items()
            }
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        status = exc.code
        response_headers = {key.lower(): value for key, value in exc.headers.items()}
    elapsed = time.perf_counter() - started
    try:
        decoded: Any = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        decoded = raw.decode(errors="replace")
    return status, response_headers, decoded, elapsed


def _audit_provider_authenticity(
    audit: ClaimAudit, captures: list[tuple[str, Json]]
) -> None:
    api_key = os.getenv("FORTYGUARD_API_KEY")
    if not api_key:
        audit.unverified(
            "PROV-EXT",
            "provenance",
            "All saved activity IDs can be authenticated against FortyGuard.",
            "--verify-provider was requested, but FORTYGUARD_API_KEY is not set",
        )
        return
    base_url = os.getenv("FORTYGUARD_BASE_URL", "https://api.fortyguard.com").rstrip("/")
    mismatches: list[str] = []
    checked = 0
    for day_text, capture in captures:
        for kind in ("heatmap", "environment"):
            saved = capture[f"{kind}_response"]
            activity_id = str(saved["data"]["activity_id"])
            try:
                status, _, live, _ = _request_json(
                    f"{base_url}/v1/status/{activity_id}",
                    headers={"api-key": api_key},
                    timeout=45,
                )
            except OSError as exc:
                mismatches.append(f"{day_text} {kind}: request failed: {exc}")
                continue
            checked += 1
            if status != 200:
                mismatches.append(f"{day_text} {kind}: HTTP {status}")
                continue
            if _canonical(live.get("data", {}).get("result")) != _canonical(
                saved.get("data", {}).get("result")
            ):
                mismatches.append(f"{day_text} {kind}: provider result differs")
    audit.record(
        "PROV-EXT",
        "provenance",
        checked == 6 and not mismatches,
        "All six saved activity results authenticate against the provider's status API.",
        "; ".join(mismatches) if mismatches else "six read-only status results match",
    )


def _normalize_api_observations(observations: list[Json]) -> list[Json]:
    result = []
    for source in observations:
        item = dict(source)
        item["timestamp"] = parse_datetime(item["timestamp"])
        result.append(item)
    return result


def audit_analysis_result(
    audit: ClaimAudit,
    result: Json,
    scenario: Json,
    policy: Json,
    check_prefix: str,
) -> None:
    required = {
        "site",
        "crews",
        "tasks",
        "heatmap_geojson",
        "observations",
        "baseline_schedule",
        "optimized_schedule",
        "movements",
        "metrics",
        "recommendations",
        "worker_alerts",
        "data_provenance",
        "policy_version",
        "limitations",
        "agent",
    }
    missing = sorted(required - set(result))
    audit.record(
        f"{check_prefix}-SHAPE",
        "api",
        result.get("status") == "completed" and not missing,
        "A completed response exposes every auditable result component.",
        f"missing={missing}",
    )
    if missing:
        return

    original_tasks = normalize_tasks(scenario["shift"]["tasks"])
    returned_tasks = normalize_tasks(result["tasks"])
    crews = scenario["crews"]
    observations = _normalize_api_observations(result["observations"])
    baseline = assess_schedule(original_tasks, crews, observations, policy)
    oracle_tasks, optimized, oracle_movements = optimize_greedy(
        original_tasks, crews, observations, policy
    )

    constraint_errors = validate_schedule(original_tasks, returned_tasks)
    starts_match = {
        task["task_id"]: parse_datetime(task["scheduled_start"]).isoformat()
        for task in returned_tasks
    } == {
        task["task_id"]: parse_datetime(task["scheduled_start"]).isoformat()
        for task in oracle_tasks
    }
    audit.record(
        f"{check_prefix}-SCHED",
        "constraints",
        not constraint_errors and starts_match,
        "The API schedule is constraint-safe and matches independent greedy enumeration.",
        "; ".join(constraint_errors)
        if constraint_errors
        else f"oracle starts match={starts_match}",
    )

    baseline_projection_match = canonical_schedule_projection(
        result["baseline_schedule"]
    ) == canonical_schedule_projection(baseline)
    optimized_projection_match = canonical_schedule_projection(
        result["optimized_schedule"]
    ) == canonical_schedule_projection(optimized)
    factors_match = (
        _factor_projection(result["baseline_schedule"])
        == _factor_projection(baseline)
        and _factor_projection(result["optimized_schedule"])
        == _factor_projection(optimized)
    )
    audit.record(
        f"{check_prefix}-SCORE",
        "calculation",
        baseline_projection_match and optimized_projection_match and factors_match,
        "Every task score, band, factor, average, and exposed worker-minute is independently reproducible.",
        (
            f"baseline={baseline_projection_match}; "
            f"optimized={optimized_projection_match}; factors={factors_match}"
        ),
    )

    cell_temperatures = [
        float(feature["properties"]["average_temperature"])
        for feature in result["heatmap_geojson"].get("features", [])
    ]
    temperature_stats = {"maximum": max(cell_temperatures)} if cell_temperatures else {"maximum": math.nan}
    expected_metrics = calculate_metrics(
        temperature_stats, observations, baseline, optimized, oracle_movements
    )
    audit.record(
        f"{check_prefix}-METRIC",
        "calculation",
        result["metrics"] == expected_metrics,
        "The response metrics are derived from task-level results, not accepted as self-assertions.",
        f"expected={_canonical(expected_metrics)}; actual={_canonical(result['metrics'])}",
    )
    movement_match = _movement_projection(result["movements"]) == _movement_projection(
        oracle_movements
    )
    audit.record(
        f"{check_prefix}-MOVE",
        "optimization",
        movement_match,
        "Movement timestamps and disruption minutes match the independent optimizer.",
        (
            f"expected={_canonical(_movement_projection(oracle_movements))}; "
            f"actual={_canonical(_movement_projection(result['movements']))}"
        ),
    )

    provenance = result["data_provenance"]
    evidence_ok = (
        len(result["heatmap_geojson"].get("features", [])) == 198
        and len(observations) == 11
        and provenance.get("heatmap_activity_id")
        == "81e55f4d-b51b-4dcc-bd4f-ab4e6c527002"
        and provenance.get("environmental_activity_id")
        == "eb97f401-3e22-44e1-a537-a86a0aa912db"
        and provenance.get("mode") in {"cached", "cached_after_live_failure"}
        and all(
            item.get("activity_id") == provenance.get("environmental_activity_id")
            for item in result["observations"]
        )
    )
    audit.record(
        f"{check_prefix}-EVID",
        "evidence",
        evidence_ok,
        "The public result retains the expected evidence counts, mode, and activity IDs.",
        (
            f"cells={len(result['heatmap_geojson'].get('features', []))}; "
            f"observations={len(observations)}; mode={provenance.get('mode')}"
        ),
    )

    traces = result["agent"].get("tool_trace", [])
    tool_ok = (
        [trace.get("tool") for trace in traces] == EXPECTED_TOOLS
        and [trace.get("sequence") for trace in traces] == list(range(1, 7))
        and all(trace.get("success") is True for trace in traces)
        and all(
            trace.get("arguments") == {"analysis_id": result["analysis_id"]}
            for trace in traces
        )
    )
    references = set(result["agent"].get("evidence_references", []))
    reference_text = "\n".join(references)
    references_ok = (
        provenance["heatmap_activity_id"] in reference_text
        and provenance["environmental_activity_id"] in reference_text
        and result["policy_version"] in reference_text
        and EXPECTED_NIOSH_LINKS.issubset(references)
    )
    audit.record(
        f"{check_prefix}-AGENT",
        "agent",
        tool_ok and references_ok,
        "The agent exposes six successful, correctly bound tools and all required evidence references.",
        f"mode={result['agent'].get('mode')}; tools_ok={tool_ok}; references_ok={references_ok}",
    )

    explanation = str(result["agent"].get("explanation", ""))
    explanation_lower = explanation.lower()
    percentages = {
        float(value)
        for value in re.findall(r"(?<![\d.])(\d+(?:\.\d+)?)\s*%", explanation)
    }
    permitted_percentages = {
        float(result["metrics"]["exposure_reduction_percent"]),
        float(result["metrics"]["productivity_retained_percent"]),
    }
    narrative_ok = (
        percentages.issubset(permitted_percentages)
        and not (
            result["metrics"]["optimized_exposed_worker_minutes"] > 0
            and any(
                phrase in explanation_lower
                for phrase in (
                    "all heat risk was eliminated",
                    "eliminated all heat risk",
                    "no residual risk",
                )
            )
        )
        and "screening" in explanation_lower
        and (
            "wbgt" in explanation_lower
            or "qualified safety professional" in explanation_lower
        )
    )
    audit.record(
        f"{check_prefix}-NARRATIVE",
        "agent",
        narrative_ok,
        "The returned briefing does not contradict headline metrics and retains the safety boundary.",
        (
            f"percentages={sorted(percentages)}; "
            f"permitted={sorted(permitted_percentages)}; "
            f"safety_boundary={narrative_ok}"
        ),
    )

    risky = {
        item["task_id"]: (item["peak_band"], item["peak_risk"])
        for item in optimized
        if item["peak_risk"] >= int(policy["high_risk_threshold"])
    }
    alerts = {
        item["alert_id"]: (item["severity"], item["task_name"])
        for item in result["worker_alerts"]
    }
    expected_alert_ids = {f"alert-{task_id}" for task_id in risky}
    audit.record(
        f"{check_prefix}-RESIDUAL",
        "safety",
        set(alerts) == expected_alert_ids and len(result["limitations"]) >= 3,
        "Residual above-threshold work remains visible and safety limitations are returned.",
        f"risky_tasks={risky}; alert_ids={sorted(alerts)}",
    )


def _deterministic_projection(result: Json) -> Json:
    return {
        key: result[key]
        for key in (
            "site",
            "crews",
            "tasks",
            "heatmap_geojson",
            "observations",
            "baseline_schedule",
            "optimized_schedule",
            "movements",
            "metrics",
            "recommendations",
            "worker_alerts",
            "data_provenance",
            "policy_version",
            "limitations",
        )
    }


def audit_heatshield_response(
    audit: ClaimAudit,
    response: Json,
    expected: Json,
    policy: Json,
    check_prefix: str = "API-VALIDATION",
) -> None:
    dataset = response.get("dataset", {})
    evidence_ok = (
        response.get("status") == "ready"
        and response.get("benchmark_type") == "descriptive_empirical_alignment"
        and dataset.get("records") == expected["records"] == 566
        and dataset.get("pseudonymous_participants")
        == expected["participants"]
        == 32
        and dataset.get("doi") == "10.6084/m9.figshare.25722300.v1"
        and dataset.get("license", {}).get("identifier") == "CC BY 4.0"
        and dataset.get("source_file_md5")
        == "e36962603afbdbd6e9856936aacab62f"
        and dataset.get("derived_csv_sha256")
        == "f80db381ab856b5720a84f27090c9b7988ff17bf29998f800b73458b8f1113d9"
    )
    audit.record(
        f"{check_prefix}-EVID",
        "empirical_validation",
        evidence_ok,
        "The API identifies the exact licensed, integrity-bound 566-session HEAT-SHIELD slice.",
        (
            f"status={response.get('status')}; records={dataset.get('records')}; "
            f"participants={dataset.get('pseudonymous_participants')}; "
            f"license={dataset.get('license', {}).get('identifier')}"
        ),
    )

    profile = response.get("benchmark_profile", {})
    profile_ok = (
        profile.get("name") == "standardized-heavy-work"
        and profile.get("policy_version") == policy["version"]
        and profile.get("workload") == "heavy"
        and profile.get("workload_points")
        == policy["workload_adjustments"]["heavy"]
        and profile.get("acclimatization") == "acclimatized"
        and profile.get("acclimatization_points")
        == policy["acclimatization_adjustments"]["acclimatized"]
        and profile.get("high_risk_threshold") == policy["high_risk_threshold"]
        and profile.get("fitted_to_dataset") is False
    )
    audit.record(
        f"{check_prefix}-PROFILE",
        "empirical_validation",
        profile_ok,
        "The API exposes the fixed policy assumptions and explicitly reports that they were not fitted to the outcome.",
        f"profile={_canonical(profile)}",
    )

    actual_metrics = response.get("metrics")
    audit.record(
        f"{check_prefix}-METRICS",
        "empirical_validation",
        actual_metrics == expected["metrics"],
        "Every public HEAT-SHIELD metric matches the independent standard-library oracle.",
        (
            f"expected_sha256={hashlib.sha256(_canonical(expected['metrics']).encode()).hexdigest()}; "
            f"actual_sha256={hashlib.sha256(_canonical(actual_metrics).encode()).hexdigest()}"
        ),
    )

    limitations = "\n".join(response.get("limitations", [])).lower()
    interpretation = str(response.get("interpretation", "")).lower()
    scope_ok = (
        len(response.get("citations", [])) >= 5
        and all(
            phrase in limitations
            for phrase in (
                "controlled environmental-chamber",
                "not heat illness",
                "not statistically independent",
                "does not fit or tune",
            )
        )
        and "descriptive external evidence" in interpretation
        and "not a fitted model or causal validation" in interpretation
    )
    audit.record(
        f"{check_prefix}-SCOPE",
        "scope",
        scope_ok,
        "The API preserves the measured-outcome, repeated-measures, non-fitted, and non-causal boundaries.",
        f"scope statements present={scope_ok}; citations={len(response.get('citations', []))}",
    )


def audit_public_api(
    root: Path, base_url: str, repetitions: int = 3
) -> ClaimAudit:
    audit = ClaimAudit()
    base_url = base_url.rstrip("/")
    policy = _load_json(root / "data/demo/policy_rules.json")
    heatshield_expected = derive_heatshield_benchmark(
        load_heatshield_trials(root / "data/validation/heatshield_trials.csv"),
        policy,
    )
    responses_for_secret_scan: list[Any] = []
    try:
        status, _, root_body, root_time = _request_json(f"{base_url}/")
        responses_for_secret_scan.append(root_body)
        audit.record(
            "API-ROOT",
            "api",
            status == 200 and root_body.get("name") == "HeatShift AI API",
            "The public service exposes the documented API discovery response.",
            f"HTTP {status} in {root_time:.3f}s",
        )
        status, _, health, health_time = _request_json(f"{base_url}/health")
        responses_for_secret_scan.append(health)
        health_ok = (
            status == 200
            and health.get("status") == "ok"
            and health.get("fortyguard", {}).get("mode") == "cached"
            and health.get("fortyguard", {}).get("cached_real_response_available")
            is True
            and health.get("deployment", {}).get("stateless_replay_recovery") is True
            and health.get("deployment", {}).get("durable_user_storage") is False
            and health.get("llm", {}).get("core_analysis_requires_llm") is False
        )
        audit.record(
            "API-HEALTH",
            "api",
            health_ok,
            "Health reports the documented cached, stateless, LLM-independent profile.",
            f"HTTP {status} in {health_time:.3f}s",
        )
        status, _, schema, schema_time = _request_json(f"{base_url}/openapi.json")
        responses_for_secret_scan.append(schema)
        expected_paths = {
            "/health",
            "/api/demo",
            "/api/demo/scenario",
            "/api/analyses",
            "/api/analyses/{analysis_id}",
            "/api/analyses/{analysis_id}/agent",
            "/api/validation/heatshield",
        }
        audit.record(
            "API-SCHEMA",
            "api",
            status == 200 and expected_paths.issubset(schema.get("paths", {})),
            "OpenAPI exposes all documented analysis operations.",
            f"HTTP {status} in {schema_time:.3f}s",
        )
        status, _, scenario, scenario_time = _request_json(
            f"{base_url}/api/demo/scenario"
        )
        responses_for_secret_scan.append(scenario)
        scenario_ok = (
            status == 200
            and scenario.get("fictional_operation") is True
            and scenario.get("site", {}).get("fictional") is True
            and len(scenario.get("crews", [])) == 3
            and sum(crew["worker_count"] for crew in scenario.get("crews", [])) == 12
            and len(scenario.get("shift", {}).get("tasks", [])) == 6
            and sum(task["movable"] for task in scenario["shift"]["tasks"]) == 2
        )
        audit.record(
            "API-SCENARIO",
            "api",
            scenario_ok,
            "The public scenario matches the disclosed fictional 3-crew, 12-worker, 6-task slice.",
            f"HTTP {status} in {scenario_time:.3f}s",
        )
        status, _, validation, validation_time = _request_json(
            f"{base_url}/api/validation/heatshield"
        )
        responses_for_secret_scan.append(validation)
        if status != 200 or not isinstance(validation, dict):
            audit.record(
                "API-VALIDATION-EVID",
                "empirical_validation",
                False,
                "The public empirical-validation endpoint returns JSON with HTTP 200.",
                f"HTTP {status} in {validation_time:.3f}s",
            )
        else:
            audit_heatshield_response(
                audit,
                validation,
                heatshield_expected,
                policy,
            )
    except (OSError, ValueError, AttributeError, KeyError) as exc:
        audit.record(
            "API-BOOT",
            "api",
            False,
            "The public API is reachable and its discovery responses are parseable.",
            str(exc),
        )
        return audit

    # CORS boundaries are tested in both directions.
    status, headers, _, _ = _request_json(
        f"{base_url}/api/demo",
        method="OPTIONS",
        headers={
            "origin": "http://localhost:3000",
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
        },
    )
    allowed = status == 200 and headers.get("access-control-allow-origin") == "http://localhost:3000"
    status_bad, bad_headers, _, _ = _request_json(
        f"{base_url}/api/demo",
        method="OPTIONS",
        headers={
            "origin": "https://example.com",
            "access-control-request-method": "POST",
        },
    )
    denied = bad_headers.get("access-control-allow-origin") != "https://example.com"
    audit.record(
        "API-CORS",
        "security",
        allowed and denied,
        "The API grants the documented local origin and does not grant an arbitrary web origin.",
        f"allowed_status={status}; untrusted_status={status_bad}; denied={denied}",
    )

    demos: list[Json] = []
    demo_times: list[float] = []
    for index in range(max(1, repetitions)):
        try:
            status, _, demo, elapsed = _request_json(
                f"{base_url}/api/demo", method="POST"
            )
            responses_for_secret_scan.append(demo)
            demo_times.append(elapsed)
            if status != 200 or not isinstance(demo, dict):
                audit.record(
                    f"REMOTE-{index + 1}-HTTP",
                    "api",
                    False,
                    "The complete analysis returns JSON with HTTP 200.",
                    f"HTTP {status} in {elapsed:.3f}s",
                )
                continue
            demos.append(demo)
            try:
                audit_analysis_result(
                    audit, demo, scenario, policy, f"REMOTE-{index + 1}"
                )
            except (KeyError, TypeError, ValueError, AssertionError) as exc:
                audit.record(
                    f"REMOTE-{index + 1}-AUDIT",
                    "api",
                    False,
                    "The complete response is structurally auditable.",
                    f"{type(exc).__name__}: {exc}",
                )
        except (OSError, ValueError) as exc:
            audit.record(
                f"REMOTE-{index + 1}-HTTP",
                "api",
                False,
                "The complete analysis returns before the 150-second evaluation timeout.",
                str(exc),
            )
    fingerprints = {
        hashlib.sha256(_canonical(_deterministic_projection(item)).encode()).hexdigest()
        for item in demos
    }
    audit.record(
        "API-REPEAT",
        "determinism",
        len(demos) == max(1, repetitions) and len(fingerprints) == 1,
        "Repeated complete analyses have identical deterministic projections.",
        (
            f"completed={len(demos)}/{max(1, repetitions)}; "
            f"unique fingerprints={len(fingerprints)}; "
            f"seconds={[round(value, 3) for value in demo_times]}"
        ),
    )

    status, _, job, _ = _request_json(
        f"{base_url}/api/analyses", method="POST", payload={}
    )
    responses_for_secret_scan.append(job)
    job_body = job if isinstance(job, dict) else {}
    job_ok = (
        status == 201
        and job_body.get("status") == "completed"
        and job_body.get("analysis_id")
        == job_body.get("result", {}).get("analysis_id")
    )
    audit.record(
        "API-JOB",
        "api",
        job_ok,
        "The job-shaped endpoint returns a completed, internally bound result.",
        (
            f"HTTP {status}; id_match="
            f"{job_body.get('analysis_id') == job_body.get('result', {}).get('analysis_id')}"
        ),
    )
    if job_ok:
        analysis_id = job_body["analysis_id"]
        status, _, fetched, _ = _request_json(
            f"{base_url}/api/analyses/{analysis_id}"
        )
        responses_for_secret_scan.append(fetched)
        status_agent, _, rerun, _ = _request_json(
            f"{base_url}/api/analyses/{analysis_id}/agent", method="POST"
        )
        responses_for_secret_scan.append(rerun)
        unchanged = (
            status == 200
            and status_agent == 200
            and fetched.get("analysis_id") == analysis_id
            and rerun.get("metrics") == job_body["result"].get("metrics")
        )
        audit.record(
            "API-RETRIEVE",
            "api",
            unchanged,
            "Job retrieval and agent rerun preserve the official result.",
            f"get={status}; agent={status_agent}; metrics_unchanged={unchanged}",
        )

    cold_id = str(uuid.uuid4())
    status, _, cold, _ = _request_json(f"{base_url}/api/analyses/{cold_id}")
    responses_for_secret_scan.append(cold)
    status_invalid, _, invalid, _ = _request_json(
        f"{base_url}/api/analyses/not-an-analysis-id"
    )
    status_custom, _, custom, _ = _request_json(
        f"{base_url}/api/analyses",
        method="POST",
        payload={"site": {"site_id": "unsupported"}},
    )
    responses_for_secret_scan.extend([invalid, custom])
    audit.record(
        "API-NEGATIVE",
        "api",
        status == 200
        and cold.get("analysis_id") == cold_id
        and status_invalid == 404
        and status_custom == 422,
        "Cold replay, invalid-ID rejection, and custom-input rejection match the narrow contract.",
        f"cold={status}; invalid={status_invalid}; custom={status_custom}",
    )

    serialized = _canonical(responses_for_secret_scan)
    secret_patterns = {
        "Groq key": r"gsk_[A-Za-z0-9]{12,}",
        "OpenAI-style key": r"\bsk-[A-Za-z0-9_-]{12,}",
        "bearer token": r"Bearer\s+[A-Za-z0-9._-]{12,}",
        "private key": r"BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY",
    }
    matches = [name for name, pattern in secret_patterns.items() if re.search(pattern, serialized)]
    audit.record(
        "API-SECRETS",
        "security",
        not matches,
        "Sampled public responses do not contain recognizable credential material.",
        f"matched patterns={matches}; scanned responses={len(responses_for_secret_scan)}",
    )
    return audit


def merge_audits(*audits: ClaimAudit) -> ClaimAudit:
    merged = ClaimAudit()
    for audit in audits:
        merged.checks.extend(audit.checks)
    return merged
