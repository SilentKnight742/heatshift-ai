from __future__ import annotations

from datetime import datetime

import pytest

from app.models.crew import Crew
from app.models.site import GeoPoint
from app.models.task import Task
from app.models.weather import EnvironmentalObservation
from app.services.risk_engine import RiskEngine


AT = datetime.fromisoformat("2026-08-28T13:00:00-07:00")


def crew(*, status: str = "acclimatized", ppe: str = "low") -> Crew:
    return Crew(
        crew_id="test",
        name="Test crew",
        worker_count=2,
        acclimatization_status=status,
        ppe_level=ppe,
        default_workload="moderate",
    )


def task(*, workload: str = "light", shaded: bool = False) -> Task:
    return Task(
        task_id="test",
        name="Test task",
        crew_id="test",
        location=GeoPoint(longitude=-112, latitude=33),
        duration_minutes=60,
        workload=workload,
        scheduled_start=AT,
        earliest_start=AT,
        latest_finish=datetime.fromisoformat("2026-08-28T14:00:00-07:00"),
        movable=False,
        shaded=shaded,
    )


def observation(apparent: float | None) -> EnvironmentalObservation:
    return EnvironmentalObservation(
        timestamp=AT,
        latitude=33,
        longitude=-112,
        apparent_temperature_c=apparent,
        source="test",
        activity_id="test",
    )


def test_score_is_clamped_to_100() -> None:
    reading = RiskEngine().calculate(
        task(workload="very_heavy"), crew(status="new", ppe="high"), observation(60), AT
    )
    assert reading.score == 100
    assert reading.band == "critical"


def test_adjustments_are_deterministic() -> None:
    engine = RiskEngine()
    base = engine.calculate(task(shaded=True), crew(), observation(36), AT)
    burdened = engine.calculate(
        task(workload="heavy", shaded=True), crew(status="new", ppe="high"), observation(36), AT
    )
    assert burdened.score - base.score == 18 + 12 + 10


def test_heavy_work_scores_above_light_work() -> None:
    engine = RiskEngine()
    light = engine.calculate(task(workload="light"), crew(), observation(39), AT)
    heavy = engine.calculate(task(workload="heavy"), crew(), observation(39), AT)
    assert heavy.score > light.score


def test_missing_apparent_temperature_fails_explicitly() -> None:
    with pytest.raises(ValueError, match="apparent temperature"):
        RiskEngine().calculate(task(), crew(), observation(None), AT)

