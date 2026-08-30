from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from statistics import fmean, median

from ..config import ROOT_DIR
from ..models.validation import HeatShieldValidationResponse


DATA_PATH = ROOT_DIR / "data/validation/heatshield_trials.csv"
PROVENANCE_PATH = ROOT_DIR / "data/validation/heatshield_provenance.json"
POLICY_PATH = ROOT_DIR / "data/demo/policy_rules.json"


def _pearson(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or len(left) < 2:
        raise ValueError("correlation requires two equally sized non-trivial samples")
    left_mean = fmean(left)
    right_mean = fmean(right)
    numerator = sum(
        (left_value - left_mean) * (right_value - right_mean)
        for left_value, right_value in zip(left, right, strict=True)
    )
    denominator = math.sqrt(
        sum((value - left_mean) ** 2 for value in left)
        * sum((value - right_mean) ** 2 for value in right)
    )
    if denominator == 0:
        raise ValueError("correlation is undefined for a constant sample")
    return numerator / denominator


def _average_ranks(values: list[float]) -> list[float]:
    ranked = sorted(enumerate(values), key=lambda item: item[1])
    result = [0.0] * len(values)
    index = 0
    while index < len(ranked):
        end = index + 1
        while end < len(ranked) and ranked[end][1] == ranked[index][1]:
            end += 1
        average_rank = ((index + 1) + end) / 2
        for ranked_index in range(index, end):
            result[ranked[ranked_index][0]] = average_rank
        index = end
    return result


def _correlation(left: list[float], right: list[float]) -> dict[str, float]:
    return {
        "pearson_r": round(_pearson(left, right), 4),
        "spearman_rho": round(
            _pearson(_average_ranks(left), _average_ranks(right)), 4
        ),
    }


def _quantile(values: list[float], probability: float) -> float:
    """Return the linearly interpolated sample quantile (R/Python type 7)."""

    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _environmental_points(apparent_temperature_c: float, policy: dict) -> int:
    for band in policy["environmental_apparent_temperature_bands_c"]:
        if band["max"] is None or apparent_temperature_c <= band["max"]:
            return int(band["points"])
    raise ValueError("policy has no open-ended environmental band")


def _risk_band(score: int, policy: dict) -> str:
    for band in policy["risk_bands"]:
        if score <= band["max"]:
            return str(band["name"])
    raise ValueError("policy has no band covering the calculated score")


def _rounded_range(rows: list[dict], field: str, unit: str) -> dict:
    values = [row[field] for row in rows]
    return {
        "minimum": round(min(values), 3),
        "maximum": round(max(values), 3),
        "unit": unit,
    }


def _load_rows() -> list[dict]:
    rows: list[dict] = []
    with DATA_PATH.open(encoding="utf-8", newline="") as stream:
        for source in csv.DictReader(stream):
            apparent_temperature = float(source["apparent_temperature_c"])
            rows.append(
                {
                    "participant_id": source["participant_id"],
                    "air_temperature_c": float(source["air_temperature_c"]),
                    "relative_humidity_percent": float(
                        source["relative_humidity_percent"]
                    ),
                    "air_speed_mps": float(source["air_speed_mps"]),
                    "apparent_temperature_c": apparent_temperature,
                    "heat_index_c": float(source["heat_index_c"]),
                    "wbgt_outdoor_c": float(source["wbgt_outdoor_c"]),
                    "utci_c": float(source["utci_c"]),
                    "measured_pwc_loss_percent": float(
                        source["measured_pwc_loss_percent"]
                    ),
                    "solar_exposure": source["solar_exposure"] == "true",
                    "high_clothing_coverage": (
                        source["high_clothing_coverage"] == "true"
                    ),
                    "apparent_temperature_for_score": apparent_temperature,
                }
            )
    return rows


@lru_cache(maxsize=1)
def heatshield_validation() -> HeatShieldValidationResponse:
    provenance = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    rows = _load_rows()

    expected_hash = provenance["derived_slice"]["sha256"]
    actual_hash = hashlib.sha256(DATA_PATH.read_bytes()).hexdigest()
    if actual_hash != expected_hash:
        raise ValueError("HEAT-SHIELD validation CSV failed its integrity check")
    if len(rows) != provenance["derived_slice"]["records"]:
        raise ValueError("HEAT-SHIELD validation row count does not match provenance")
    participant_count = len({row["participant_id"] for row in rows})
    if participant_count != provenance["derived_slice"]["pseudonymous_participants"]:
        raise ValueError(
            "HEAT-SHIELD validation participant count does not match provenance"
        )

    workload_points = int(policy["workload_adjustments"]["heavy"])
    acclimatization_points = int(
        policy["acclimatization_adjustments"]["acclimatized"]
    )
    scores: list[float] = []
    environmental_scores: list[float] = []
    losses: list[float] = []
    by_band: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for row in rows:
        environmental = _environmental_points(
            row["apparent_temperature_for_score"], policy
        )
        ppe_points = (
            int(policy["ppe_adjustments"]["high"])
            if row["high_clothing_coverage"]
            else int(policy["ppe_adjustments"]["low"])
        )
        solar_points = (
            int(policy["direct_solar_adjustment"])
            if row["solar_exposure"]
            else 0
        )
        score = max(
            0,
            min(
                100,
                environmental
                + workload_points
                + acclimatization_points
                + ppe_points
                + solar_points,
            ),
        )
        loss = row["measured_pwc_loss_percent"]
        scores.append(float(score))
        environmental_scores.append(float(environmental))
        losses.append(loss)
        by_band[_risk_band(score, policy)].append((score, loss))

    threshold = int(policy["high_risk_threshold"])
    below = [loss for score, loss in zip(scores, losses, strict=True) if score < threshold]
    high = [loss for score, loss in zip(scores, losses, strict=True) if score >= threshold]
    bands = []
    for configured_band in policy["risk_bands"]:
        band_name = str(configured_band["name"])
        records = by_band.get(band_name, [])
        if not records:
            continue
        band_scores = [score for score, _ in records]
        band_losses = [loss for _, loss in records]
        bands.append(
            {
                "band": band_name,
                "records": len(records),
                "score_minimum": min(band_scores),
                "score_maximum": max(band_scores),
                "mean_measured_pwc_loss_percent": round(fmean(band_losses), 2),
                "median_measured_pwc_loss_percent": round(median(band_losses), 2),
                "p25_measured_pwc_loss_percent": round(
                    _quantile(band_losses, 0.25), 2
                ),
                "p75_measured_pwc_loss_percent": round(
                    _quantile(band_losses, 0.75), 2
                ),
            }
        )

    dataset = provenance["dataset"]
    source_file = provenance["source_file"]
    derived = provenance["derived_slice"]
    below_mean_raw = fmean(below)
    high_mean_raw = fmean(high)
    below_mean = round(below_mean_raw, 2)
    high_mean = round(high_mean_raw, 2)
    return HeatShieldValidationResponse.model_validate(
        {
            "status": "ready",
            "benchmark_type": "descriptive_empirical_alignment",
            "dataset": {
                "title": dataset["title"],
                "doi": dataset["doi"],
                "landing_page": dataset["landing_page"],
                "publisher": dataset["publisher"],
                "published_date": dataset["published_date"],
                "funding": dataset["funding"],
                "license": dataset["license"],
                "records": len(rows),
                "pseudonymous_participants": participant_count,
                "source_file_id": source_file["figshare_file_id"],
                "source_file_md5": source_file["md5"],
                "derived_csv_sha256": actual_hash,
            },
            "benchmark_profile": {
                "name": "standardized-heavy-work",
                "policy_version": policy["version"],
                "workload": "heavy",
                "workload_points": workload_points,
                "acclimatization": "acclimatized",
                "acclimatization_points": acclimatization_points,
                "clothing_mapping": (
                    "Source coverall YES maps to high PPE (+10); NO maps to low PPE (+0)."
                ),
                "solar_mapping": (
                    "Source experimental solar YES adds the policy's direct-solar +6."
                ),
                "high_risk_threshold": threshold,
                "fitted_to_dataset": False,
            },
            "metrics": {
                "outcome": "Measured one-hour physical work capacity loss (%)",
                "score_vs_measured_pwc_loss": _correlation(scores, losses),
                "environmental_points_vs_measured_pwc_loss": _correlation(
                    environmental_scores, losses
                ),
                "comparative_index_correlations": {
                    "apparent_temperature": _correlation(
                        [row["apparent_temperature_c"] for row in rows], losses
                    ),
                    "heat_index": _correlation(
                        [row["heat_index_c"] for row in rows], losses
                    ),
                    "wbgt_outdoor": _correlation(
                        [row["wbgt_outdoor_c"] for row in rows], losses
                    ),
                    "utci": _correlation([row["utci_c"] for row in rows], losses),
                },
                "below_high_risk_threshold": {
                    "records": len(below),
                    "mean_measured_pwc_loss_percent": below_mean,
                },
                "at_or_above_high_risk_threshold": {
                    "records": len(high),
                    "mean_measured_pwc_loss_percent": high_mean,
                },
                "mean_loss_difference_percentage_points": round(
                    high_mean_raw - below_mean_raw, 2
                ),
                "bands": bands,
                "input_ranges": {
                    "air_temperature": _rounded_range(
                        rows, "air_temperature_c", "degC"
                    ),
                    "relative_humidity": _rounded_range(
                        rows, "relative_humidity_percent", "percent"
                    ),
                    "air_speed": _rounded_range(rows, "air_speed_mps", "m/s"),
                    "apparent_temperature": _rounded_range(
                        rows, "apparent_temperature_c", "degC"
                    ),
                    "wbgt_outdoor": _rounded_range(
                        rows, "wbgt_outdoor_c", "degC"
                    ),
                    "utci": _rounded_range(rows, "utci_c", "degC"),
                    "measured_pwc_loss": _rounded_range(
                        rows, "measured_pwc_loss_percent", "percent"
                    ),
                },
            },
            "interpretation": (
                "Under a fixed, pre-existing policy profile, sessions at or above "
                "HeatShift's high-risk threshold had substantially greater measured "
                "physical work capacity loss than sessions below it. This is descriptive "
                "external evidence, not a fitted model or causal validation."
            ),
            "limitations": provenance["limitations"],
            "citations": provenance["required_attribution"],
        }
    )
