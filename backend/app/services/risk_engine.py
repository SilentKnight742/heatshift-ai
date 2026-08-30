from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from ..config import ROOT_DIR
from ..models.analysis import RiskFactor, RiskReading, ScheduleItem
from ..models.crew import Crew
from ..models.task import Task
from ..models.weather import EnvironmentalObservation


class RiskEngine:
    """Deterministic, policy-file-driven screening risk calculator."""

    def __init__(self, policy_path: Path | None = None):
        self.policy_path = policy_path or ROOT_DIR / "data/demo/policy_rules.json"
        self.policy = json.loads(self.policy_path.read_text())

    def calculate(
        self,
        task: Task,
        crew: Crew,
        observation: EnvironmentalObservation,
        at_time: datetime,
    ) -> RiskReading:
        apparent = observation.apparent_temperature_c
        if apparent is None:
            raise ValueError("apparent temperature is required for screening risk")

        environmental_points = self._environmental_points(apparent)
        factors = [
            RiskFactor(
                name="environmental_conditions",
                points=environmental_points,
                detail=f"Apparent temperature {apparent:.1f}°C",
            )
        ]
        adjustments = [
            (
                f"{task.workload.value}_workload",
                self.policy["workload_adjustments"][task.workload.value],
                f"{task.workload.value.replace('_', ' ')} task workload",
            ),
            (
                f"{crew.acclimatization_status.value}_crew",
                self.policy["acclimatization_adjustments"][crew.acclimatization_status.value],
                f"{crew.acclimatization_status.value} acclimatization status",
            ),
            (
                f"{crew.ppe_level.value}_ppe_burden",
                self.policy["ppe_adjustments"][crew.ppe_level.value],
                f"{crew.ppe_level.value} PPE burden",
            ),
        ]
        start_hour, end_hour = self.policy["direct_solar_hours"]
        if task.shaded:
            adjustments.append(
                ("shade_available", self.policy["shaded_adjustment"], "Task is in a shaded area")
            )
        elif start_hour <= at_time.hour < end_hour:
            adjustments.append(
                (
                    "direct_solar_exposure",
                    self.policy["direct_solar_adjustment"],
                    "Unshaded work during configured solar exposure hours",
                )
            )

        for name, points, detail in adjustments:
            if points:
                factors.append(RiskFactor(name=name, points=points, detail=detail))
        score = max(0, min(100, sum(factor.points for factor in factors)))
        return RiskReading(score=score, band=self._band(score), factors=factors)

    def assess_task(
        self,
        task: Task,
        crew: Crew,
        observations: list[EnvironmentalObservation],
    ) -> ScheduleItem:
        slot_minutes = self.policy["slot_minutes"]
        remaining = task.duration_minutes
        cursor = task.scheduled_start
        weighted_score = 0.0
        exposed_worker_minutes = 0
        peak: RiskReading | None = None
        while remaining > 0:
            minutes = min(slot_minutes, remaining)
            observation = self._nearest_observation(cursor, observations)
            reading = self.calculate(task, crew, observation, cursor)
            weighted_score += reading.score * minutes
            if reading.score >= self.policy["high_risk_threshold"]:
                exposed_worker_minutes += minutes * crew.worker_count
            if peak is None or reading.score > peak.score:
                peak = reading
            cursor += timedelta(minutes=minutes)
            remaining -= minutes
        assert peak is not None
        return ScheduleItem(
            task_id=task.task_id,
            task_name=task.name,
            crew_id=crew.crew_id,
            crew_name=crew.name,
            worker_count=crew.worker_count,
            workload=task.workload.value,
            start=task.scheduled_start,
            end=task.scheduled_end,
            movable=task.movable,
            shaded=task.shaded,
            average_risk=round(weighted_score / task.duration_minutes, 1),
            peak_risk=peak.score,
            peak_band=peak.band,
            exposed_worker_minutes=exposed_worker_minutes,
            risk_factors=peak.factors,
        )

    def assess_schedule(
        self,
        tasks: list[Task],
        crews: dict[str, Crew],
        observations: list[EnvironmentalObservation],
    ) -> list[ScheduleItem]:
        return sorted(
            [self.assess_task(task, crews[task.crew_id], observations) for task in tasks],
            key=lambda item: item.start,
        )

    def _environmental_points(self, apparent_temperature_c: float) -> int:
        for band in self.policy["environmental_apparent_temperature_bands_c"]:
            if band["max"] is None or apparent_temperature_c <= band["max"]:
                return int(band["points"])
        raise AssertionError("policy must contain an open-ended environmental band")

    def _band(self, score: int) -> str:
        for band in self.policy["risk_bands"]:
            if score <= band["max"]:
                return str(band["name"])
        return "critical"

    @staticmethod
    def _nearest_observation(
        timestamp: datetime,
        observations: list[EnvironmentalObservation],
    ) -> EnvironmentalObservation:
        if not observations:
            raise ValueError("at least one environmental observation is required")
        return min(observations, key=lambda observation: abs(observation.timestamp - timestamp))

