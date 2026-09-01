from __future__ import annotations

from datetime import datetime, timedelta

from ..models.weekly import JobStatus, PlanLayer, ScheduleEntry, SiteDay, WeeklyCrew, WeeklyJob
from .weekly_metrics import entry_for, spatial_offsets_for_job


class WeeklyOptimizer:
    """Deterministic greedy placement with a bounded whole-week improvement pass."""

    def optimize(
        self,
        jobs: list[WeeklyJob],
        crews: dict[str, WeeklyCrew],
        days: list[SiteDay],
    ) -> list[ScheduleEntry]:
        active = [job for job in jobs if job.status != JobStatus.CANCELLED]
        spatial_offsets = {job.job_id: spatial_offsets_for_job(job, days) for job in active}
        originals = {
            job.job_id: entry_for(job, crews[job.assigned_crew_id], job.original_start, PlanLayer.HEATSHIFT, days, spatial_offsets[job.job_id])
            for job in active
        }
        schedule = dict(originals)
        movable = sorted(
            (job for job in active if job.movable and job.status not in {JobStatus.COMPLETED, JobStatus.IN_PROGRESS}),
            key=lambda item: (-crews[item.assigned_crew_id].worker_count, -item.duration_minutes, item.original_start, item.job_id),
        )
        # Two deterministic passes give earlier placements one bounded opportunity
        # to improve after later jobs have moved, without implying global optimality.
        for _ in range(2):
            improved = False
            for job in movable:
                best = None if job.status == JobStatus.DEFERRED else schedule[job.job_id]
                best_objective = None if best is None else self._schedule_objective(schedule, originals, crews)
                for crew_id in sorted(job.eligible_crew_ids):
                    if crew_id not in crews:
                        continue
                    for start in self._candidate_starts(job):
                        candidate = entry_for(job, crews[crew_id], start, PlanLayer.HEATSHIFT, days, spatial_offsets[job.job_id])
                        if not self._valid(candidate, schedule, jobs):
                            continue
                        prospective = {**schedule, job.job_id: candidate}
                        objective = self._schedule_objective(prospective, originals, crews)
                        if best_objective is None or objective < best_objective:
                            best = candidate
                            best_objective = objective
                if best is None:
                    raise ValueError(f"{job.name}: deferred job has no feasible later slot")
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
    def _candidate_starts(job: WeeklyJob):
        cursor = _ceil_half_hour(job.earliest_start)
        if job.status == JobStatus.DEFERRED:
            next_day = (job.original_start + timedelta(days=1)).replace(
                hour=job.earliest_start.hour,
                minute=job.earliest_start.minute,
                second=0,
                microsecond=0,
            )
            cursor = _ceil_half_hour(max(cursor, next_day))
        duration = timedelta(minutes=job.duration_minutes)
        while cursor + duration <= job.latest_finish:
            yield cursor
            cursor += timedelta(minutes=30)

    @staticmethod
    def _schedule_objective(
        schedule: dict[str, ScheduleEntry],
        originals: dict[str, ScheduleEntry],
        crews: dict[str, WeeklyCrew],
    ) -> tuple:
        high_risk_worker_minutes = 0.0
        load_by_crew = {crew_id: 0.0 for crew_id in crews}
        shifted_minutes = 0.0
        crew_changes = 0
        cross_day_moves = 0
        for job_id, entry in schedule.items():
            duration_minutes = (entry.end - entry.start).total_seconds() / 60
            worker_count = crews[entry.crew_id].worker_count
            if entry.screening_score >= 50:
                high_risk_worker_minutes += duration_minutes * worker_count
            load_by_crew[entry.crew_id] += entry.screening_score / 100 * duration_minutes / 60 * worker_count
            original = originals[job_id]
            shifted_minutes += abs((entry.start - original.start).total_seconds()) / 60
            crew_changes += int(entry.crew_id != original.crew_id)
            cross_day_moves += int(entry.start.date() != original.start.date())
        total_load = sum(load_by_crew.values())
        highest_crew_load = max(load_by_crew.values(), default=0.0)
        return (
            high_risk_worker_minutes,
            round(total_load, 6),
            round(highest_crew_load, 6),
            shifted_minutes,
            crew_changes,
            cross_day_moves,
            tuple((item.start, item.crew_id, item.job_id) for item in sorted(schedule.values(), key=lambda value: value.job_id)),
        )

    @staticmethod
    def _valid(candidate: ScheduleEntry, schedule: dict[str, ScheduleEntry], jobs: list[WeeklyJob]) -> bool:
        job_by_id = {job.job_id: job for job in jobs}
        job = job_by_id[candidate.job_id]
        if candidate.start < job.earliest_start or candidate.end > job.latest_finish:
            return False
        if candidate.crew_id not in job.eligible_crew_ids:
            return False
        for other in schedule.values():
            if other.job_id == candidate.job_id:
                continue
            if other.crew_id == candidate.crew_id and candidate.start < other.end and other.start < candidate.end:
                return False
        for dependency_id in job.dependencies:
            dependency = schedule.get(dependency_id)
            if dependency is None or candidate.start < dependency.end:
                return False
        for dependent in jobs:
            if candidate.job_id in dependent.dependencies:
                dependent_entry = schedule.get(dependent.job_id)
                if dependent_entry and candidate.end > dependent_entry.start:
                    return False
        return True


def validate_schedule(entries: list[ScheduleEntry], jobs: list[WeeklyJob]) -> list[str]:
    errors: list[str] = []
    job_by_id = {job.job_id: job for job in jobs}
    active_job_ids = {job.job_id for job in jobs if job.status != JobStatus.CANCELLED}
    submitted_ids = [entry.job_id for entry in entries]
    if len(submitted_ids) != len(set(submitted_ids)):
        errors.append("working plan contains duplicate jobs")
    unknown = set(submitted_ids) - active_job_ids
    if unknown:
        errors.append("working plan contains a job outside this site")
    missing = active_job_ids - set(submitted_ids)
    if missing:
        errors.append("working plan must include every non-cancelled job")
    if errors:
        return errors
    entry_by_id = {entry.job_id: entry for entry in entries}
    for entry in entries:
        job = job_by_id[entry.job_id]
        if entry.start < job.earliest_start or entry.end > job.latest_finish:
            errors.append(f"{job.name}: outside its allowed date/time window")
        if entry.crew_id not in job.eligible_crew_ids:
            errors.append(f"{job.name}: crew is not eligible")
        if entry.start.minute % 30 or entry.start.second or entry.start.microsecond:
            errors.append(f"{job.name}: start must align to a 30-minute boundary")
        if job.status == JobStatus.DEFERRED and entry.start.date() <= job.original_start.date():
            errors.append(f"{job.name}: deferred work must move to a later date")
        if entry.end - entry.start != timedelta(minutes=job.duration_minutes):
            errors.append(f"{job.name}: duration changed")
        if (not job.movable or job.status in {JobStatus.COMPLETED, JobStatus.IN_PROGRESS}) and (
            entry.start != job.original_start or entry.crew_id != job.assigned_crew_id
        ):
            errors.append(f"{job.name}: locked work cannot move or change crew")
        for dependency_id in job.dependencies:
            dependency = entry_by_id.get(dependency_id)
            if dependency is None or entry.start < dependency.end:
                errors.append(f"{job.name}: dependency must finish first")
    for index, left in enumerate(entries):
        for right in entries[index + 1:]:
            if left.crew_id == right.crew_id and left.start < right.end and right.start < left.end:
                errors.append(f"{job_by_id[left.job_id].name}: crew overlaps {job_by_id[right.job_id].name}")
    return errors


def _ceil_half_hour(value: datetime) -> datetime:
    rounded = value.replace(second=0, microsecond=0)
    remainder = rounded.minute % 30
    if remainder:
        rounded += timedelta(minutes=30 - remainder)
    return rounded
