from __future__ import annotations

from datetime import datetime, timedelta

from ..models.analysis import Movement, ScheduleItem
from ..models.crew import Crew
from ..models.task import Task
from ..models.weather import EnvironmentalObservation
from .risk_engine import RiskEngine


class ScheduleOptimizer:
    """Deterministic greedy scheduler prioritizing heavy work in cooler valid slots."""

    WORKLOAD_RANK = {"very_heavy": 4, "heavy": 3, "moderate": 2, "light": 1}

    def __init__(self, risk_engine: RiskEngine):
        self.risk_engine = risk_engine

    def optimize(
        self,
        tasks: list[Task],
        crews: dict[str, Crew],
        observations: list[EnvironmentalObservation],
    ) -> tuple[list[Task], list[ScheduleItem], list[Movement]]:
        schedule = {task.task_id: task.model_copy(deep=True) for task in tasks}
        movable = sorted(
            (task for task in tasks if task.movable),
            key=lambda task: (-self.WORKLOAD_RANK[task.workload.value], task.scheduled_start),
        )
        movements: list[Movement] = []
        for original in movable:
            best = schedule[original.task_id]
            best_assessment = self.risk_engine.assess_task(
                best, crews[best.crew_id], observations
            )
            best_objective = self._objective(best_assessment, original.scheduled_start)
            for start in self._candidate_starts(original):
                candidate = original.model_copy(update={"scheduled_start": start})
                if not self._valid(candidate, schedule):
                    continue
                assessment = self.risk_engine.assess_task(
                    candidate, crews[candidate.crew_id], observations
                )
                objective = self._objective(assessment, original.scheduled_start)
                if objective < best_objective:
                    best, best_assessment, best_objective = candidate, assessment, objective
            schedule[original.task_id] = best
            if best.scheduled_start != original.scheduled_start:
                baseline = self.risk_engine.assess_task(
                    original, crews[original.crew_id], observations
                )
                delta = int(abs((best.scheduled_start - original.scheduled_start).total_seconds()) // 60)
                movements.append(
                    Movement(
                        task_id=original.task_id,
                        task_name=original.name,
                        from_start=original.scheduled_start,
                        to_start=best.scheduled_start,
                        minutes_moved=delta,
                        reason=(
                            f"Moves {original.workload.value.replace('_', ' ')} work into the coolest "
                            f"valid crew window; peak screening score falls from "
                            f"{baseline.peak_risk} ({baseline.peak_band}) to "
                            f"{best_assessment.peak_risk} ({best_assessment.peak_band})."
                        ),
                    )
                )
        optimized_tasks = sorted(schedule.values(), key=lambda task: task.scheduled_start)
        assessed = self.risk_engine.assess_schedule(optimized_tasks, crews, observations)
        self._validate_final(tasks, optimized_tasks)
        return optimized_tasks, assessed, movements

    def _objective(self, item: ScheduleItem, original_start: datetime) -> float:
        disruption = abs((item.start - original_start).total_seconds()) / 60
        return (
            item.average_risk * (item.end - item.start).total_seconds() / 60 * item.worker_count
            + disruption * self.risk_engine.policy["disruption_penalty_per_minute"]
        )

    def _candidate_starts(self, task: Task):
        cursor = task.earliest_start
        duration = timedelta(minutes=task.duration_minutes)
        step = timedelta(minutes=self.risk_engine.policy["slot_minutes"])
        while cursor + duration <= task.latest_finish:
            yield cursor
            cursor += step

    @staticmethod
    def _overlap(left: Task, right: Task) -> bool:
        return left.scheduled_start < right.scheduled_end and right.scheduled_start < left.scheduled_end

    def _valid(self, candidate: Task, schedule: dict[str, Task]) -> bool:
        for other in schedule.values():
            if other.task_id == candidate.task_id:
                continue
            if other.crew_id == candidate.crew_id and self._overlap(candidate, other):
                return False
        for dependency_id in candidate.dependencies:
            if candidate.scheduled_start < schedule[dependency_id].scheduled_end:
                return False
        for dependent in schedule.values():
            if candidate.task_id in dependent.dependencies and candidate.scheduled_end > dependent.scheduled_start:
                return False
        return True

    def _validate_final(self, original: list[Task], optimized: list[Task]) -> None:
        originals = {task.task_id: task for task in original}
        optimized_by_id = {task.task_id: task for task in optimized}
        for task_id, task in originals.items():
            revised = optimized_by_id[task_id]
            if not task.movable and revised.scheduled_start != task.scheduled_start:
                raise AssertionError(f"fixed task {task_id} moved")
            if revised.duration_minutes != task.duration_minutes:
                raise AssertionError(f"task {task_id} duration changed")
            for dependency in revised.dependencies:
                if revised.scheduled_start < optimized_by_id[dependency].scheduled_end:
                    raise AssertionError(f"dependency violated for {task_id}")
        for index, left in enumerate(optimized):
            for right in optimized[index + 1 :]:
                if left.crew_id == right.crew_id and self._overlap(left, right):
                    raise AssertionError(f"crew overlap: {left.task_id} and {right.task_id}")

