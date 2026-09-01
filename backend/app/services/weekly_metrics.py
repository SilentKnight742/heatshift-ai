from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Iterable

from ..models.weekly import (
    DisruptionComponents,
    HourlyCondition,
    JobStatus,
    MetricExplanation,
    PlanLayer,
    ScheduleEntry,
    SiteDay,
    WeeklyCrew,
    WeeklyJob,
    WeeklyMetrics,
)


HIGH_RISK_THRESHOLD = 50
THERMAL_BURDEN_BASELINE_C = 35.0


def nearest_condition(timestamp: datetime, days: list[SiteDay]) -> HourlyCondition:
    conditions = [condition for day in days for condition in day.conditions]
    if not conditions:
        raise ValueError("site-week has no hourly environmental evidence")
    return min(conditions, key=lambda item: abs(item.timestamp - timestamp))


def screening_score(job: WeeklyJob, crew: WeeklyCrew, condition: HourlyCondition, at_time: datetime) -> int:
    apparent = condition.apparent_temperature_c
    environmental = 8 if apparent <= 35 else 20 if apparent <= 38 else 32 if apparent <= 41 else 45 if apparent <= 44 else 55
    workload = {"light": 4, "moderate": 12, "heavy": 20, "very_heavy": 28}[job.workload.value]
    acclimatization = {"acclimatized": 0, "returning": 8, "new": 14}[crew.acclimatization_status.value]
    ppe = {"low": 0, "medium": 7, "high": 14}[crew.ppe_level.value]
    solar = -10 if job.shaded else 10 if 10 <= at_time.hour < 16 else 0
    return max(0, min(100, environmental + workload + acclimatization + ppe + solar))


def entry_for(job: WeeklyJob, crew: WeeklyCrew, start: datetime, layer: PlanLayer, days: list[SiteDay]) -> ScheduleEntry:
    slot = timedelta(minutes=30)
    remaining = job.duration_minutes
    cursor = start
    weighted = 0
    while remaining > 0:
        minutes = min(30, remaining)
        weighted += screening_score(job, crew, nearest_condition(cursor, days), cursor) * minutes
        cursor += slot
        remaining -= minutes
    return ScheduleEntry(
        job_id=job.job_id,
        crew_id=crew.crew_id,
        start=start,
        end=start + timedelta(minutes=job.duration_minutes),
        source=layer,
        screening_score=round(weighted / job.duration_minutes),
    )


def entries_for(
    jobs: Iterable[WeeklyJob],
    crews: dict[str, WeeklyCrew],
    days: list[SiteDay],
    layer: PlanLayer,
) -> list[ScheduleEntry]:
    return sorted(
        [entry_for(job, crews[job.assigned_crew_id], job.original_start, layer, days) for job in jobs if job.status != JobStatus.CANCELLED],
        key=lambda item: item.start,
    )


def site_thermal_burden(days: list[SiteDay]) -> float:
    return round(sum(max(0.0, condition.apparent_temperature_c - THERMAL_BURDEN_BASELINE_C) for day in days for condition in day.conditions), 1)


def crew_loads(entries: list[ScheduleEntry], jobs: dict[str, WeeklyJob], crews: dict[str, WeeklyCrew]) -> dict[str, float]:
    loads: dict[str, float] = defaultdict(float)
    for entry in entries:
        job = jobs[entry.job_id]
        if job.status == JobStatus.CANCELLED:
            continue
        duration_hours = (entry.end - entry.start).total_seconds() / 3600
        loads[entry.crew_id] += entry.screening_score / 100 * duration_hours * crews[entry.crew_id].worker_count
    return {crew_id: round(value, 2) for crew_id, value in loads.items()}


def high_risk_worker_minutes(entries: list[ScheduleEntry], crews: dict[str, WeeklyCrew]) -> int:
    return round(sum(
        (entry.end - entry.start).total_seconds() / 60 * crews[entry.crew_id].worker_count
        for entry in entries
        if entry.screening_score >= HIGH_RISK_THRESHOLD
    ))


def disruption(original: list[ScheduleEntry], proposed: list[ScheduleEntry], jobs: dict[str, WeeklyJob]) -> DisruptionComponents:
    before = {entry.job_id: entry for entry in original}
    after = {entry.job_id: entry for entry in proposed}
    shifted = 0
    reassignments = 0
    cross_day = 0
    for job_id, revised in after.items():
        baseline = before.get(job_id)
        if baseline is None:
            continue
        shifted += round(abs((revised.start - baseline.start).total_seconds()) / 60)
        reassignments += int(revised.crew_id != baseline.crew_id)
        cross_day += int(revised.start.date() != baseline.start.date())
    return DisruptionComponents(
        total_minutes_shifted=shifted,
        crew_reassignments=reassignments,
        cross_day_moves=cross_day,
        manager_deferrals=sum(job.status == JobStatus.DEFERRED for job in jobs.values()),
        cancellations=sum(job.status == JobStatus.CANCELLED for job in jobs.values()),
        hard_constraint_violations=0,
    )


def calculate_weekly_metrics(
    days: list[SiteDay],
    jobs_list: list[WeeklyJob],
    crews: dict[str, WeeklyCrew],
    original: list[ScheduleEntry],
    proposed: list[ScheduleEntry],
) -> WeeklyMetrics:
    jobs = {job.job_id: job for job in jobs_list}
    original_exposure = high_risk_worker_minutes(original, crews)
    proposed_exposure = high_risk_worker_minutes(proposed, crews)
    original_loads = crew_loads(original, jobs, crews)
    proposed_loads = crew_loads(proposed, jobs, crews)
    highest = max(proposed_loads, key=proposed_loads.get) if proposed_loads else None
    spread = max(proposed_loads.values()) - min(proposed_loads.values()) if len(proposed_loads) > 1 else 0.0
    active_minutes = sum(job.duration_minutes for job in jobs_list if job.status != JobStatus.CANCELLED)
    submitted_minutes = sum(job.duration_minutes for job in jobs_list)
    return WeeklyMetrics(
        original_exposure_worker_minutes=original_exposure,
        proposed_exposure_worker_minutes=proposed_exposure,
        high_risk_hours_avoided=round(max(0, original_exposure - proposed_exposure) / 60, 1),
        risk_reduction_percent=round((original_exposure - proposed_exposure) / original_exposure * 100, 1) if original_exposure else 0.0,
        tasks_rescheduled=sum(
            job_id in {entry.job_id for entry in proposed}
            and next(item for item in proposed if item.job_id == job_id).start != original_entry.start
            for job_id, original_entry in {entry.job_id: entry for entry in original}.items()
        ),
        fixed_tasks_preserved=sum(not job.movable for job in jobs_list),
        residual_alerts=sum(entry.screening_score >= HIGH_RISK_THRESHOLD for entry in proposed),
        productive_task_time_retained_percent=round(active_minutes / submitted_minutes * 100, 1) if submitted_minutes else 100.0,
        constraint_valid=True,
        site_thermal_burden_degree_hours=site_thermal_burden(days),
        original_crew_exposure_load=round(sum(original_loads.values()), 2),
        proposed_crew_exposure_load=round(sum(proposed_loads.values()), 2),
        highest_loaded_crew_id=highest,
        crew_load_spread=round(spread, 2),
        disruption=disruption(original, proposed, jobs),
    )


def metric_explanations(metrics: WeeklyMetrics) -> dict[str, MetricExplanation]:
    return {
        "thermal_burden": MetricExplanation(
            metric="Site Thermal Burden",
            definition="How intense and persistent the site's apparent heat is across the selected week.",
            formula="Σ max(0, hourly apparent temperature − 35°C) × 1 hour",
            inputs={"baseline_c": THERMAL_BURDEN_BASELINE_C, "degree_hours": metrics.site_thermal_burden_degree_hours},
            source="FortyGuard hourly site conditions; HeatShift calculation",
            comparison=f"{metrics.site_thermal_burden_degree_hours:.1f} apparent-temperature degree-hours this week.",
            limitations=["35°C is a configurable product threshold, not a medical limit.", "It describes the site, not an individual worker."],
        ),
        "crew_load": MetricExplanation(
            metric="Crew Exposure Load",
            definition="Cumulative risk-weighted worker-hours assigned to crews.",
            formula="Σ (task screening score ÷ 100) × duration hours × worker count",
            inputs={"original": metrics.original_crew_exposure_load, "proposed": metrics.proposed_crew_exposure_load},
            source="HeatShift task-hour screening policy and operation inputs",
            comparison=f"{metrics.original_crew_exposure_load:.2f} → {metrics.proposed_crew_exposure_load:.2f} risk-weighted worker-hours.",
            limitations=["This is a planning indicator, not a dose measurement or medical assessment."],
        ),
        "disruption": MetricExplanation(
            metric="Operational Disruption",
            definition="The visible logistical changes required by the selected plan.",
            formula="Minutes shifted, crew changes, cross-day moves, deferrals and cancellations reported separately",
            inputs=metrics.disruption.model_dump(),
            source="Difference between immutable Original and selected plan entries",
            comparison=f"{metrics.disruption.total_minutes_shifted} minutes shifted; {metrics.disruption.crew_reassignments} crew changes.",
            limitations=["HeatShift deliberately does not compress these trade-offs into an opaque score."],
        ),
        "risk_reduction": MetricExplanation(
            metric="High-risk exposure reduction",
            definition="Change in worker-minutes scheduled at a task screening score of 50 or higher.",
            formula="(original − proposed) ÷ original × 100",
            inputs={"original_worker_minutes": metrics.original_exposure_worker_minutes, "proposed_worker_minutes": metrics.proposed_exposure_worker_minutes, "threshold": HIGH_RISK_THRESHOLD},
            source="HeatShift deterministic schedule comparison",
            comparison=f"{metrics.risk_reduction_percent:.1f}% lower at the disclosed score-50 threshold.",
            limitations=["The percentage is threshold-dependent and does not imply injury reduction."],
        ),
    }

