from __future__ import annotations

from datetime import datetime, timedelta

from ..models.weekly import JobStatus, PlanLayer, ScheduleEntry, SiteDay, WeeklyCrew, WeeklyJob
from .weekly_metrics import entry_for


class WeeklyOptimizer:
    """Deterministic greedy placement with a bounded one-job local improvement pass."""

    def optimize(
        self,
        jobs: list[WeeklyJob],
        crews: dict[str, WeeklyCrew],
        days: list[SiteDay],
    ) -> list[ScheduleEntry]:
        active = [job for job in jobs if job.status != JobStatus.CANCELLED]
        schedule = {
            job.job_id: entry_for(job, crews[job.assigned_crew_id], job.original_start, PlanLayer.HEATSHIFT, days)
            for job in active
        }
        movable = sorted(
            (job for job in active if job.movable and job.status not in {JobStatus.COMPLETED, JobStatus.IN_PROGRESS}),
            key=lambda item: (-crews[item.assigned_crew_id].worker_count, -item.duration_minutes, item.original_start, item.job_id),
        )
        for job in movable:
            current = schedule[job.job_id]
            best = current
            best_objective = self._objective(best, current, crews)
            for crew_id in sorted(job.eligible_crew_ids):
                if crew_id not in crews:
                    continue
                for start in self._candidate_starts(job):
                    candidate = entry_for(job, crews[crew_id], start, PlanLayer.HEATSHIFT, days)
                    if not self._valid(candidate, schedule, jobs):
                        continue
                    objective = self._objective(candidate, current, crews)
                    if objective < best_objective:
                        best = candidate
                        best_objective = objective
            schedule[job.job_id] = best
        result = sorted(schedule.values(), key=lambda item: (item.start, item.job_id))
        errors = validate_schedule(result, jobs)
        if errors:
            raise AssertionError("; ".join(errors))
        return result

    @staticmethod
    def _candidate_starts(job: WeeklyJob):
        cursor = job.earliest_start
        duration = timedelta(minutes=job.duration_minutes)
        while cursor + duration <= job.latest_finish:
            yield cursor
            cursor += timedelta(minutes=30)

    @staticmethod
    def _objective(candidate: ScheduleEntry, original: ScheduleEntry, crews: dict[str, WeeklyCrew]) -> tuple:
        high_risk = int(candidate.screening_score >= 50) * (candidate.end - candidate.start).total_seconds() / 60 * crews[candidate.crew_id].worker_count
        exposure_load = candidate.screening_score / 100 * (candidate.end - candidate.start).total_seconds() / 3600 * crews[candidate.crew_id].worker_count
        shifted = abs((candidate.start - original.start).total_seconds()) / 60
        crew_change = int(candidate.crew_id != original.crew_id)
        cross_day = int(candidate.start.date() != original.start.date())
        return high_risk, exposure_load, exposure_load, shifted + crew_change * 60 + cross_day * 120, candidate.start, candidate.crew_id

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
    entry_by_id = {entry.job_id: entry for entry in entries}
    for entry in entries:
        job = job_by_id[entry.job_id]
        if entry.start < job.earliest_start or entry.end > job.latest_finish:
            errors.append(f"{job.name}: outside its allowed date/time window")
        if entry.crew_id not in job.eligible_crew_ids:
            errors.append(f"{job.name}: crew is not eligible")
        if entry.end - entry.start != timedelta(minutes=job.duration_minutes):
            errors.append(f"{job.name}: duration changed")
        if (not job.movable or job.status in {JobStatus.COMPLETED, JobStatus.IN_PROGRESS}) and entry.start != job.original_start:
            errors.append(f"{job.name}: locked work cannot move")
        for dependency_id in job.dependencies:
            dependency = entry_by_id.get(dependency_id)
            if dependency is None or entry.start < dependency.end:
                errors.append(f"{job.name}: dependency must finish first")
    for index, left in enumerate(entries):
        for right in entries[index + 1:]:
            if left.crew_id == right.crew_id and left.start < right.end and right.start < left.end:
                errors.append(f"{job_by_id[left.job_id].name}: crew overlaps {job_by_id[right.job_id].name}")
    return errors

