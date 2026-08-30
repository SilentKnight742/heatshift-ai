from __future__ import annotations

import asyncio
import copy
import json
import random
from datetime import datetime
from pathlib import Path

import pytest

import claim_evaluation.suite as claim_suite
from app.agent.runner import AgentRunner
from app.models.crew import Crew
from app.models.site import GeoPoint
from app.models.task import Task
from app.models.weather import EnvironmentalObservation
from app.services.analysis_service import AnalysisService
from app.services.risk_engine import RiskEngine
from app.services.validation_service import heatshield_validation
from claim_evaluation.oracle import (
    derive_heatshield_benchmark,
    load_heatshield_trials,
    score_segment,
)
from claim_evaluation.suite import (
    ClaimAudit,
    audit_analysis_result,
    audit_heatshield_response,
    audit_repository,
)


ROOT = Path(__file__).resolve().parents[2]
POLICY = json.loads((ROOT / "data/demo/policy_rules.json").read_text())
AT = datetime.fromisoformat("2026-08-28T13:00:00-07:00")


class UnavailableLLM:
    available = False


def _completed_result() -> tuple[dict, dict]:
    service = AnalysisService()
    result = asyncio.run(service.run_demo())
    result.agent = asyncio.run(AgentRunner(llm=UnavailableLLM()).run(result))
    site, crews, shift = service.load_demo_scenario()
    scenario = {
        "site": site.model_dump(mode="json"),
        "crews": [crew.model_dump(mode="json") for crew in crews],
        "shift": shift.model_dump(mode="json"),
        "fictional_operation": True,
    }
    return result.model_dump(mode="json"), scenario


def test_repository_claims_pass_independent_offline_audit() -> None:
    report = audit_repository(ROOT).report()
    assert report["counts"]["FAIL"] == 0
    # File structure and IDs cannot authenticate their own provider origin.
    assert report["counts"]["UNVERIFIED"] == 1
    assert any(
        check["check_id"] == "CALC-AGG" and check["status"] == "PASS"
        for check in report["checks"]
    )
    assert all(
        any(
            check["check_id"] == check_id and check["status"] == "PASS"
            for check in report["checks"]
        )
        for check_id in (
            "HSHIELD-EVID",
            "HSHIELD-CALC",
            "HSHIELD-BANDS",
            "HSHIELD-INDICES",
            "HSHIELD-SCOPE",
        )
    )


def test_heatshield_claims_match_independent_oracle() -> None:
    rows = load_heatshield_trials(ROOT / "data/validation/heatshield_trials.csv")
    result = derive_heatshield_benchmark(rows, POLICY)

    assert result["records"] == 566
    assert result["participants"] == 32
    assert result["study_ids"] == [1, 2, 3, 4, 5, 6]
    assert result["metrics"]["score_vs_measured_pwc_loss"] == {
        "pearson_r": 0.7744,
        "spearman_rho": 0.7718,
    }
    assert result["metrics"]["mean_loss_difference_percentage_points"] == 36.45
    assert sum(row["records"] for row in result["metrics"]["bands"]) == 566


def test_heatshield_evaluator_detects_metric_profile_and_scope_tampering() -> None:
    expected = derive_heatshield_benchmark(
        load_heatshield_trials(ROOT / "data/validation/heatshield_trials.csv"),
        POLICY,
    )
    response = heatshield_validation().model_dump(mode="json")
    response["metrics"]["score_vs_measured_pwc_loss"]["spearman_rho"] = 0.9999
    response["benchmark_profile"]["fitted_to_dataset"] = True
    response["limitations"] = []

    audit = ClaimAudit()
    audit_heatshield_response(audit, response, expected, POLICY, "MUTANT-HS")
    failures = {check.check_id for check in audit.failed}
    assert failures == {
        "MUTANT-HS-PROFILE",
        "MUTANT-HS-METRICS",
        "MUTANT-HS-SCOPE",
    }


def test_optional_provider_authentication_compares_all_six_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = {}
    for _, capture in claim_suite.load_captures(ROOT):
        for kind in ("heatmap", "environment"):
            response = capture[f"{kind}_response"]
            responses[response["data"]["activity_id"]] = response

    def provider_status(url: str, **_kwargs):
        activity_id = url.rsplit("/", 1)[-1]
        return 200, {}, responses[activity_id], 0.01

    monkeypatch.setenv("FORTYGUARD_API_KEY", "test-only-key")
    monkeypatch.setattr(claim_suite, "_request_json", provider_status)
    report = audit_repository(ROOT, verify_provider=True).report()
    provider_check = next(
        check for check in report["checks"] if check["check_id"] == "PROV-EXT"
    )
    assert provider_check["status"] == "PASS"
    assert "six read-only status results match" in provider_check["evidence"]


def test_complete_backend_result_matches_independent_oracle() -> None:
    result, scenario = _completed_result()
    audit = ClaimAudit()
    audit_analysis_result(audit, result, scenario, POLICY, "LOCAL")
    assert not audit.failed, "\n".join(
        f"{check.check_id}: {check.evidence}" for check in audit.failed
    )


def test_evaluator_detects_metric_and_schedule_tampering() -> None:
    result, scenario = _completed_result()
    tampered = copy.deepcopy(result)
    tampered["metrics"]["exposure_reduction_percent"] = 99.9
    fixed_task = next(task for task in tampered["tasks"] if not task["movable"])
    fixed_task["scheduled_start"] = "2026-08-28T06:30:00-07:00"
    tampered["agent"]["explanation"] = (
        "Official reduction is 99.9%; all heat risk was eliminated."
    )

    audit = ClaimAudit()
    audit_analysis_result(audit, tampered, scenario, POLICY, "MUTANT")
    failures = {check.check_id for check in audit.failed}
    assert "MUTANT-METRIC" in failures
    assert "MUTANT-SCHED" in failures
    assert "MUTANT-NARRATIVE" in failures


@pytest.mark.parametrize(
    "temperature",
    [
        -20.0,
        35.0,
        35.0001,
        38.0,
        38.0001,
        41.0,
        41.0001,
        44.0,
        44.0001,
        70.0,
    ],
)
def test_policy_boundaries_match_independent_oracle(temperature: float) -> None:
    _assert_backend_matches_oracle(
        temperature=temperature,
        workload="very_heavy",
        acclimatization="new",
        ppe="high",
        shaded=False,
        hour=13,
    )


def test_randomized_policy_combinations_match_independent_oracle() -> None:
    generator = random.Random(742)
    workloads = list(POLICY["workload_adjustments"])
    acclimatization = list(POLICY["acclimatization_adjustments"])
    ppe_levels = list(POLICY["ppe_adjustments"])
    for _ in range(300):
        _assert_backend_matches_oracle(
            temperature=generator.uniform(-20, 75),
            workload=generator.choice(workloads),
            acclimatization=generator.choice(acclimatization),
            ppe=generator.choice(ppe_levels),
            shaded=generator.choice([True, False]),
            hour=generator.randrange(24),
        )


def test_missing_apparent_temperature_is_rejected_by_both_calculators() -> None:
    task, crew, observation, raw_task, raw_crew = _inputs(
        temperature=None,
        workload="light",
        acclimatization="acclimatized",
        ppe="low",
        shaded=False,
        hour=9,
    )
    with pytest.raises(ValueError, match="apparent temperature"):
        RiskEngine().calculate(task, crew, observation, task.scheduled_start)
    with pytest.raises(ValueError, match="apparent temperature"):
        score_segment(raw_task, raw_crew, None, task.scheduled_start, POLICY)


def _inputs(
    *,
    temperature: float | None,
    workload: str,
    acclimatization: str,
    ppe: str,
    shaded: bool,
    hour: int,
) -> tuple[Task, Crew, EnvironmentalObservation, dict, dict]:
    timestamp = AT.replace(hour=hour)
    task = Task(
        task_id="differential-task",
        name="Differential task",
        crew_id="differential-crew",
        location=GeoPoint(longitude=-112.0, latitude=33.0),
        duration_minutes=30,
        workload=workload,
        scheduled_start=timestamp,
        earliest_start=timestamp,
        latest_finish=timestamp.replace(minute=30),
        movable=False,
        shaded=shaded,
    )
    crew = Crew(
        crew_id="differential-crew",
        name="Differential crew",
        worker_count=2,
        acclimatization_status=acclimatization,
        ppe_level=ppe,
        default_workload=workload,
    )
    observation = EnvironmentalObservation(
        timestamp=timestamp,
        latitude=33.0,
        longitude=-112.0,
        apparent_temperature_c=temperature,
        source="differential fixture",
        activity_id="differential",
    )
    return (
        task,
        crew,
        observation,
        task.model_dump(mode="json"),
        crew.model_dump(mode="json"),
    )


def _assert_backend_matches_oracle(
    *,
    temperature: float,
    workload: str,
    acclimatization: str,
    ppe: str,
    shaded: bool,
    hour: int,
) -> None:
    task, crew, observation, raw_task, raw_crew = _inputs(
        temperature=temperature,
        workload=workload,
        acclimatization=acclimatization,
        ppe=ppe,
        shaded=shaded,
        hour=hour,
    )
    backend = RiskEngine().calculate(task, crew, observation, task.scheduled_start)
    oracle = score_segment(
        raw_task, raw_crew, temperature, task.scheduled_start, POLICY
    )
    assert backend.score == oracle["score"]
    assert backend.band == oracle["band"]
    assert sorted((factor.name, factor.points) for factor in backend.factors) == sorted(
        (factor["name"], factor["points"]) for factor in oracle["factors"]
    )
