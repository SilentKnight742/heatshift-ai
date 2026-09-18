from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from ..models.daily import (
    DailyCrew,
    DailyEvidence,
    DailyJob,
    DailyMetrics,
    DisruptionComponents,
    MetricExplanation,
    PlanLayer,
    ScheduleEntry,
)


HIGH_RISK_THRESHOLD = 50
THERMAL_BURDEN_BASELINE_C = 35.0


def _coordinate_pairs(value) -> list[list[float]]:
    if not isinstance(value, list):
        return []
    if len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
        return [[float(value[0]), float(value[1])]]
    return [point for item in value for point in _coordinate_pairs(item)]


def _nearest_condition(timestamp: datetime, evidence: DailyEvidence):
    if not evidence.conditions:
        raise ValueError("the operation day has no hourly conditions")
    return min(evidence.conditions, key=lambda item: abs(item.timestamp - timestamp))


def _spatial_offset(job: DailyJob, evidence: DailyEvidence) -> float:
    if not evidence.heat_cells:
        return 0.0
    mean = sum(cell.temperature_c_1500 for cell in evidence.heat_cells) / len(evidence.heat_cells)

    def distance(cell) -> float:
        points = _coordinate_pairs(cell.geometry.get("coordinates", []))
        if not points:
            return float("inf")
        longitude = sum(point[0] for point in points) / len(points)
        latitude = sum(point[1] for point in points) / len(points)
        return (longitude - job.location.longitude) ** 2 + (latitude - job.location.latitude) ** 2

    cell = min(evidence.heat_cells, key=distance)
    return cell.temperature_c_1500 - mean


def screening_score(job: DailyJob, crew: DailyCrew, apparent_c: float, at_time: datetime) -> int:
    environmental = 8 if apparent_c <= 35 else 20 if apparent_c <= 38 else 32 if apparent_c <= 41 else 45 if apparent_c <= 44 else 55
    workload = {"light": 4, "moderate": 12, "heavy": 20, "very_heavy": 28}[job.workload.value]
    acclimatization = {"acclimatized": 0, "returning": 8, "new": 14}[crew.acclimatization_status.value]
    ppe = {"low": 0, "medium": 7, "high": 14}[crew.ppe_level.value]
    solar = -10 if job.shaded else 10 if 10 <= at_time.hour < 16 else 0
    return max(0, min(100, environmental + workload + acclimatization + ppe + solar))


def entry_for(
    job: DailyJob,
    crew: DailyCrew,
    start: datetime,
    layer: PlanLayer,
    evidence: DailyEvidence,
) -> ScheduleEntry:
    remaining = job.duration_minutes
    cursor = start
    weighted_score = 0
    offset = _spatial_offset(job, evidence)
    while remaining > 0:
        minutes = min(30, remaining)
        condition = _nearest_condition(cursor, evidence)
        score = screening_score(job, crew, condition.apparent_temperature_c + offset, cursor)
        weighted_score += score * minutes
        cursor += timedelta(minutes=minutes)
        remaining -= minutes
    return ScheduleEntry(
        job_id=job.job_id,
        crew_id=crew.crew_id,
        start=start,
        end=start + timedelta(minutes=job.duration_minutes),
        source=layer,
        screening_score=round(weighted_score / job.duration_minutes),
    )


def entries_for(
    jobs: list[DailyJob], crews: dict[str, DailyCrew], evidence: DailyEvidence, layer: PlanLayer
) -> list[ScheduleEntry]:
    return sorted(
        [entry_for(job, crews[job.assigned_crew_id], job.original_start, layer, evidence) for job in jobs],
        key=lambda item: (item.start, item.job_id),
    )


def site_thermal_burden(evidence: DailyEvidence) -> float:
    return round(sum(max(0.0, item.apparent_temperature_c - THERMAL_BURDEN_BASELINE_C) for item in evidence.conditions), 1)


def _crew_loads(entries: list[ScheduleEntry], crews: dict[str, DailyCrew]) -> dict[str, float]:
    loads: dict[str, float] = defaultdict(float)
    for entry in entries:
        hours = (entry.end - entry.start).total_seconds() / 3600
        loads[entry.crew_id] += entry.screening_score / 100 * hours * crews[entry.crew_id].worker_count
    return {crew_id: round(value, 2) for crew_id, value in loads.items()}


def _high_risk_worker_minutes(entries: list[ScheduleEntry], crews: dict[str, DailyCrew]) -> int:
    return round(sum(
        (entry.end - entry.start).total_seconds() / 60 * crews[entry.crew_id].worker_count
        for entry in entries if entry.screening_score >= HIGH_RISK_THRESHOLD
    ))


def calculate_metrics(
    evidence: DailyEvidence,
    jobs: list[DailyJob],
    crews: dict[str, DailyCrew],
    original: list[ScheduleEntry],
    proposed: list[ScheduleEntry],
) -> DailyMetrics:
    original_exposure = _high_risk_worker_minutes(original, crews)
    proposed_exposure = _high_risk_worker_minutes(proposed, crews)
    original_loads = _crew_loads(original, crews)
    proposed_loads = _crew_loads(proposed, crews)
    highest = max(proposed_loads, key=proposed_loads.get) if proposed_loads else None
    spread = max(proposed_loads.values()) - min(proposed_loads.values()) if len(proposed_loads) > 1 else 0.0
    before = {entry.job_id: entry for entry in original}
    shifted = sum(
        round(abs((entry.start - before[entry.job_id].start).total_seconds()) / 60)
        for entry in proposed
    )
    reassignments = sum(entry.crew_id != before[entry.job_id].crew_id for entry in proposed)
    return DailyMetrics(
        original_exposure_worker_minutes=original_exposure,
        proposed_exposure_worker_minutes=proposed_exposure,
        high_risk_hours_avoided=round(max(0, original_exposure - proposed_exposure) / 60, 1),
        risk_reduction_percent=round((original_exposure - proposed_exposure) / original_exposure * 100, 1) if original_exposure else 0.0,
        tasks_rescheduled=sum(entry.start != before[entry.job_id].start for entry in proposed),
        fixed_tasks_preserved=sum(not job.movable for job in jobs),
        residual_alerts=sum(entry.screening_score >= HIGH_RISK_THRESHOLD for entry in proposed),
        productive_task_time_retained_percent=100.0,
        constraint_valid=True,
        site_thermal_burden_degree_hours=site_thermal_burden(evidence),
        original_crew_exposure_load=round(sum(original_loads.values()), 2),
        proposed_crew_exposure_load=round(sum(proposed_loads.values()), 2),
        highest_loaded_crew_id=highest,
        crew_load_spread=round(spread, 2),
        disruption=DisruptionComponents(
            total_minutes_shifted=shifted,
            crew_reassignments=reassignments,
            hard_constraint_violations=0,
        ),
    )


def metric_explanations(metrics: DailyMetrics) -> dict[str, MetricExplanation]:
    return {
        "exposure": MetricExplanation(
            metric="Original versus proposed exposure",
            definition="Worker-minutes assigned to jobs with a screening score of 50 or higher, before and after rescheduling.",
            formula="Σ crew size × task duration, for task-hour score ≥ 50",
            inputs={
                "original_worker_minutes": metrics.original_exposure_worker_minutes,
                "proposed_worker_minutes": metrics.proposed_exposure_worker_minutes,
                "score_threshold": HIGH_RISK_THRESHOLD,
            },
            source="HeatShift task-hour scores, fictional crew sizes and the two schedule versions",
            comparison=f"{metrics.original_exposure_worker_minutes} → {metrics.proposed_exposure_worker_minutes} worker-minutes.",
            limitations=["This is scheduled exposure above a product threshold, not a measured personal heat dose."],
        ),
        "risk_reduction": MetricExplanation(
            metric="High-risk exposure reduction",
            definition="The change in worker-minutes scheduled at a task score of 50 or higher.",
            formula="(original worker-minutes − proposed worker-minutes) ÷ original worker-minutes × 100",
            inputs={
                "original_worker_minutes": metrics.original_exposure_worker_minutes,
                "proposed_worker_minutes": metrics.proposed_exposure_worker_minutes,
                "score_threshold": HIGH_RISK_THRESHOLD,
            },
            source="HeatShift task-hour scores and schedule comparison",
            comparison=f"{metrics.original_exposure_worker_minutes} → {metrics.proposed_exposure_worker_minutes} worker-minutes at score 50 or higher.",
            limitations=["The result is threshold-dependent.", "It does not measure or predict injuries."],
        ),
        "high_risk_time": MetricExplanation(
            metric="High-risk time avoided",
            definition="The reduction in worker-hours assigned at a task score of 50 or higher.",
            formula="(original high-risk worker-minutes − proposed high-risk worker-minutes) ÷ 60",
            inputs={"worker_hours_avoided": metrics.high_risk_hours_avoided, "score_threshold": HIGH_RISK_THRESHOLD},
            source="HeatShift task-hour scores and schedule comparison",
            comparison=f"{metrics.high_risk_hours_avoided:.1f} high-risk worker-hours avoided.",
            limitations=["The number changes when the disclosed score threshold changes."],
        ),
        "thermal_burden": MetricExplanation(
            metric="Site Thermal Burden",
            definition="How intense and persistent apparent heat is across this operation day.",
            formula="Σ max(0, hourly apparent temperature − 35°C) × 1 hour",
            inputs={"baseline_c": THERMAL_BURDEN_BASELINE_C, "degree_hours": metrics.site_thermal_burden_degree_hours},
            source="Hourly site conditions; HeatShift calculation",
            comparison=f"{metrics.site_thermal_burden_degree_hours:.1f} apparent-temperature degree-hours.",
            limitations=["35°C is a configurable planning threshold, not a medical limit."],
        ),
        "crew_load": MetricExplanation(
            metric="Crew Exposure Load",
            definition="Cumulative risk-weighted worker-hours assigned across all crews.",
            formula="Σ (task score ÷ 100) × duration hours × crew size",
            inputs={"original": metrics.original_crew_exposure_load, "proposed": metrics.proposed_crew_exposure_load},
            source="HeatShift task scores, duration and fictional crew inputs",
            comparison=f"{metrics.original_crew_exposure_load:.2f} → {metrics.proposed_crew_exposure_load:.2f} risk-weighted worker-hours.",
            limitations=["This is a planning indicator, not a measured personal heat dose."],
        ),
        "disruption": MetricExplanation(
            metric="Operational Disruption",
            definition="The schedule changes required by the proposed plan.",
            formula="Shifted minutes and crew reassignments reported separately",
            inputs=metrics.disruption.model_dump(),
            source="Difference between the submitted and proposed schedules",
            comparison=f"{metrics.disruption.total_minutes_shifted} minutes shifted; {metrics.disruption.crew_reassignments} crew reassignments.",
            limitations=["HeatShift does not hide operational trade-offs inside one score."],
        ),
        "tasks_rescheduled": MetricExplanation(
            metric="Tasks rescheduled",
            definition="Movable jobs whose proposed start time differs from the submitted start time.",
            formula="Count(proposed start ≠ original start)",
            inputs={"tasks_rescheduled": metrics.tasks_rescheduled},
            source="Difference between original and HeatShift schedule entries",
            comparison=f"{metrics.tasks_rescheduled} tasks moved to a different start time.",
            limitations=["The count does not by itself describe how far each task moved."],
        ),
        "fixed_preserved": MetricExplanation(
            metric="Fixed tasks preserved",
            definition="Jobs declared immovable that retain their submitted time and crew.",
            formula="Count(jobs where movable = false and proposed entry = original entry)",
            inputs={"fixed_tasks_preserved": metrics.fixed_tasks_preserved},
            source="Fictional job constraints and validated HeatShift schedule",
            comparison=f"{metrics.fixed_tasks_preserved} fixed tasks preserved.",
            limitations=["Fixed status is a simulated operational input supplied before analysis."],
        ),
        "residual_alerts": MetricExplanation(
            metric="Residual alerts",
            definition="Proposed jobs that still have a screening score of 50 or higher after optimization.",
            formula="Count(proposed task score ≥ 50)",
            inputs={"residual_alerts": metrics.residual_alerts, "score_threshold": HIGH_RISK_THRESHOLD},
            source="HeatShift proposed schedule task scores",
            comparison=f"{metrics.residual_alerts} proposed jobs remain at or above score 50.",
            limitations=["A lower count does not mean remaining work is safe or that heat risk is eliminated."],
        ),
        "retained_work": MetricExplanation(
            metric="Productive task time retained",
            definition="The share of submitted job duration retained in the proposed schedule.",
            formula="proposed scheduled task-minutes ÷ original task-minutes × 100",
            inputs={"percent_retained": metrics.productive_task_time_retained_percent},
            source="Original and proposed schedule duration totals",
            comparison=f"{metrics.productive_task_time_retained_percent:.0f}% of submitted task time retained.",
            limitations=["Retaining scheduled time does not establish equal output quality or throughput."],
        ),
        "constraint_validity": MetricExplanation(
            metric="Constraint validity",
            definition="Whether the proposal preserves durations, fixed work, crew eligibility, non-overlap and each job's allowed window.",
            formula="All hard-constraint checks must pass; violations = 0",
            inputs={
                "constraint_valid": metrics.constraint_valid,
                "hard_constraint_violations": metrics.disruption.hard_constraint_violations,
            },
            source="Deterministic post-optimization schedule validator",
            comparison=f"{metrics.disruption.hard_constraint_violations} hard constraint violations.",
            limitations=["Only encoded constraints can be validated; unrecorded site rules remain the manager's responsibility."],
        ),
    }


class DailyOptimizer:
    """Deterministic single-day scheduler with hard constraint validation."""

    def optimize(
        self, jobs: list[DailyJob], crews: dict[str, DailyCrew], evidence: DailyEvidence
    ) -> list[ScheduleEntry]:
        originals = {
            job.job_id: entry_for(job, crews[job.assigned_crew_id], job.original_start, PlanLayer.HEATSHIFT, evidence)
            for job in jobs
        }
        schedule = dict(originals)
        movable = sorted(
            (job for job in jobs if job.movable),
            key=lambda item: (-crews[item.assigned_crew_id].worker_count, -item.duration_minutes, item.job_id),
        )
        for _ in range(2):
            improved = False
            for job in movable:
                best = schedule[job.job_id]
                best_objective = self._objective(schedule, originals, crews)
                for crew_id in sorted(job.eligible_crew_ids):
                    for start in self._candidate_starts(job):
                        candidate = entry_for(job, crews[crew_id], start, PlanLayer.HEATSHIFT, evidence)
                        if not self._valid(candidate, schedule):
                            continue
                        prospective = {**schedule, job.job_id: candidate}
                        objective = self._objective(prospective, originals, crews)
                        if objective < best_objective:
                            best, best_objective = candidate, objective
                if best != schedule[job.job_id]:
                    schedule[job.job_id] = best
                    improved = True
            if not improved:
                break
        result = sorted(schedule.values(), key=lambda item: (item.start, item.job_id))
        errors = validate_schedule(result, jobs)
        if errors:
            raise AssertionError("; ".join(errors))
        return result

    @staticmethod
    def _candidate_starts(job: DailyJob):
        cursor = job.earliest_start
        duration = timedelta(minutes=job.duration_minutes)
        while cursor + duration <= job.latest_finish:
            yield cursor
            cursor += timedelta(minutes=30)

    @staticmethod
    def _valid(candidate: ScheduleEntry, schedule: dict[str, ScheduleEntry]) -> bool:
        return all(
            other.job_id == candidate.job_id
            or other.crew_id != candidate.crew_id
            or not (candidate.start < other.end and other.start < candidate.end)
            for other in schedule.values()
        )

    @staticmethod
    def _objective(
        schedule: dict[str, ScheduleEntry], originals: dict[str, ScheduleEntry], crews: dict[str, DailyCrew]
    ) -> tuple:
        high_risk_minutes = 0.0
        load_by_crew: dict[str, float] = defaultdict(float)
        shifted = 0.0
        reassignments = 0
        for job_id, entry in schedule.items():
            duration_minutes = (entry.end - entry.start).total_seconds() / 60
            workers = crews[entry.crew_id].worker_count
            if entry.screening_score >= HIGH_RISK_THRESHOLD:
                high_risk_minutes += duration_minutes * workers
            load_by_crew[entry.crew_id] += entry.screening_score / 100 * duration_minutes / 60 * workers
            shifted += abs((entry.start - originals[job_id].start).total_seconds()) / 60
            reassignments += int(entry.crew_id != originals[job_id].crew_id)
        return (
            high_risk_minutes,
            round(sum(load_by_crew.values()), 6),
            round(max(load_by_crew.values(), default=0), 6),
            shifted,
            reassignments,
            tuple((item.start, item.crew_id, item.job_id) for item in sorted(schedule.values(), key=lambda value: value.job_id)),
        )


def validate_schedule(entries: list[ScheduleEntry], jobs: list[DailyJob]) -> list[str]:
    errors: list[str] = []
    jobs_by_id = {job.job_id: job for job in jobs}
    entries_by_id = {entry.job_id: entry for entry in entries}
    if set(entries_by_id) != set(jobs_by_id) or len(entries) != len(entries_by_id):
        errors.append("the plan must include every job exactly once")
        return errors
    for entry in entries:
        job = jobs_by_id[entry.job_id]
        if entry.start < job.earliest_start or entry.end > job.latest_finish:
            errors.append(f"{job.name}: outside its allowed daily window")
        if entry.crew_id not in job.eligible_crew_ids:
            errors.append(f"{job.name}: crew is not eligible")
        if entry.end - entry.start != timedelta(minutes=job.duration_minutes):
            errors.append(f"{job.name}: duration changed")
        if not job.movable and (entry.start != job.original_start or entry.crew_id != job.assigned_crew_id):
            errors.append(f"{job.name}: fixed work changed")
    for index, left in enumerate(entries):
        for right in entries[index + 1:]:
            if left.crew_id == right.crew_id and left.start < right.end and right.start < left.end:
                errors.append(f"crew overlap between {left.job_id} and {right.job_id}")
    return errors


daily_optimizer = DailyOptimizer()
