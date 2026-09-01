from __future__ import annotations

import asyncio
import copy
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from ..models.site import GeoPoint
from ..models.weekly import (
    DEFAULT_WEEK_START,
    DataStatus,
    JobStatus,
    PlanLayer,
    ScheduleEntry,
    SiteWorkspace,
    WeeklyAnalysis,
    WeeklyCrew,
    WeeklyCrewCreate,
    WeeklyJob,
    WeeklyJobCreate,
    WeeklySite,
    WeeklySiteCreate,
    WorkingPlanPatch,
    WorkspaceState,
)
from .portfolio import build_curated_portfolio
from .auth import current_workspace_principal
from .state_catalog import normalize_geometry, polygon_centroid, state_options, validate_in_state
from .workspace_persistence import workspace_persistence
from .state_boundaries import point_in_feature_collection
from .weekly_metrics import calculate_weekly_metrics, entries_for, entry_for, metric_explanations
from .weekly_optimizer import WeeklyOptimizer, validate_schedule
from .weekly_ai import generate_weekly_briefing


@dataclass
class SiteRecord:
    site: WeeklySite
    crews: list[WeeklyCrew]
    jobs: list[WeeklyJob]
    days: list
    analysis: WeeklyAnalysis | None = None


@dataclass
class WorkspaceRecord:
    owner_id: str
    state: WorkspaceState
    sites: dict[str, SiteRecord] = field(default_factory=dict)
    provisioning: dict[str, Any] = field(default_factory=dict)
    idempotency: dict[str, str] = field(default_factory=dict)
    questions_by_day: dict[str, int] = field(default_factory=dict)


class WeeklyStore:
    def __init__(self) -> None:
        self._workspaces: dict[str, WorkspaceRecord] = {}
        self._hydrated: set[str] = set()
        self._curated = build_curated_portfolio()
        self._lock = asyncio.Lock()
        self._optimizer = WeeklyOptimizer()

    async def workspace(self, owner_id: str) -> WorkspaceRecord:
        async with self._lock:
            if owner_id not in self._workspaces:
                sites = {
                    site_id: SiteRecord(
                        site=site.model_copy(deep=True),
                        crews=[crew.model_copy(deep=True) for crew in crews],
                        jobs=[job.model_copy(deep=True) for job in jobs],
                        days=[day.model_copy(deep=True) for day in days],
                    )
                    for site_id, (site, crews, jobs, days) in self._curated.items()
                }
                self._workspaces[owner_id] = WorkspaceRecord(
                    owner_id=owner_id,
                    state=WorkspaceState(
                        workspace_id=owner_id,
                        week_start=DEFAULT_WEEK_START,
                        live_site_week_used=False,
                        live_site_weeks_remaining=1,
                        walkthrough_completed=False,
                    ),
                    sites=sites,
                )
            principal = current_workspace_principal.get()
            if (
                owner_id not in self._hydrated
                and principal
                and principal.user_id == owner_id
                and principal.access_token
                and workspace_persistence.enabled
            ):
                snapshot = await workspace_persistence.load(owner_id, principal.access_token)
                if snapshot:
                    self._restore_snapshot(self._workspaces[owner_id], snapshot)
                self._hydrated.add(owner_id)
            return self._workspaces[owner_id]

    async def save(self, owner_id: str) -> None:
        principal = current_workspace_principal.get()
        if not principal or principal.user_id != owner_id or not principal.access_token:
            return
        workspace = self._workspaces.get(owner_id)
        if workspace:
            await workspace_persistence.save(owner_id, principal.access_token, self._snapshot(workspace))

    def _snapshot(self, workspace: WorkspaceRecord) -> dict[str, Any]:
        custom_sites: dict[str, Any] = {}
        curated_operations: dict[str, Any] = {}
        for site_id, record in workspace.sites.items():
            serialized = {
                "site": record.site.model_dump(mode="json"),
                "crews": [item.model_dump(mode="json") for item in record.crews],
                "jobs": [item.model_dump(mode="json") for item in record.jobs],
                "analysis": record.analysis.model_dump(mode="json") if record.analysis else None,
            }
            if record.site.curated:
                curated_operations[site_id] = {
                    "crews": serialized["crews"],
                    "jobs": serialized["jobs"],
                    "analysis": serialized["analysis"],
                }
            else:
                custom_sites[site_id] = {
                    **serialized,
                    "days": [item.model_dump(mode="json") for item in record.days],
                }
        return {
            "version": 1,
            "state": workspace.state.model_dump(mode="json"),
            "custom_sites": custom_sites,
            "curated_operations": curated_operations,
            "provisioning": {
                key: value.model_dump(mode="json") if hasattr(value, "model_dump") else value
                for key, value in workspace.provisioning.items()
            },
            "idempotency": workspace.idempotency,
            "questions_by_day": workspace.questions_by_day,
        }

    @staticmethod
    def _restore_snapshot(workspace: WorkspaceRecord, snapshot: dict[str, Any]) -> None:
        from ..models.weekly import SiteDay

        if snapshot.get("version") != 1:
            return
        workspace.state = WorkspaceState.model_validate(snapshot.get("state", {}))
        for site_id, overlay in snapshot.get("curated_operations", {}).items():
            record = workspace.sites.get(site_id)
            if not record:
                continue
            record.crews = [WeeklyCrew.model_validate(item) for item in overlay.get("crews", [])]
            record.jobs = [WeeklyJob.model_validate(item) for item in overlay.get("jobs", [])]
            record.analysis = WeeklyAnalysis.model_validate(overlay["analysis"]) if overlay.get("analysis") else None
        for site_id, value in snapshot.get("custom_sites", {}).items():
            workspace.sites[site_id] = SiteRecord(
                site=WeeklySite.model_validate(value["site"]),
                crews=[WeeklyCrew.model_validate(item) for item in value.get("crews", [])],
                jobs=[WeeklyJob.model_validate(item) for item in value.get("jobs", [])],
                days=[SiteDay.model_validate(item) for item in value.get("days", [])],
                analysis=WeeklyAnalysis.model_validate(value["analysis"]) if value.get("analysis") else None,
            )
        workspace.provisioning = copy.deepcopy(snapshot.get("provisioning", {}))
        for value in workspace.provisioning.values():
            if isinstance(value.get("week_start"), str):
                value["week_start"] = date.fromisoformat(value["week_start"])
        workspace.idempotency = dict(snapshot.get("idempotency", {}))
        workspace.questions_by_day = dict(snapshot.get("questions_by_day", {}))

    async def patch_workspace(self, owner_id: str, patch: dict[str, Any]) -> WorkspaceState:
        workspace = await self.workspace(owner_id)
        allowed = {"week_start", "walkthrough_completed"}
        unknown = set(patch) - allowed
        if unknown:
            raise ValueError(f"unsupported workspace fields: {', '.join(sorted(unknown))}")
        if "week_start" in patch:
            week_start = date.fromisoformat(str(patch["week_start"]))
            if week_start < date(2019, 1, 1):
                raise ValueError("week must start on or after January 1, 2019")
            last_completed = datetime.now(timezone.utc).date() - timedelta(days=1)
            if week_start + timedelta(days=6) > last_completed:
                raise ValueError("week must end no later than the last completed day")
            workspace.state.week_start = week_start
        if "walkthrough_completed" in patch:
            workspace.state.walkthrough_completed = bool(patch["walkthrough_completed"])
        await self.save(owner_id)
        return workspace.state

    async def list_sites(self, owner_id: str, state_code: str) -> list[WeeklySite]:
        workspace = await self.workspace(owner_id)
        selected_week = workspace.state.week_start
        sites = []
        for record in workspace.sites.values():
            if record.site.state_code != state_code.upper():
                continue
            site = record.site.model_copy(deep=True)
            if site.evidence_week_start != selected_week:
                site.data_status = DataStatus.UNAVAILABLE
                site.thermal_burden = None
                site.source_label = "No evidence for the selected week"
            sites.append(site)
        return sorted(sites, key=lambda item: item.name)

    async def create_site(self, owner_id: str, payload: WeeklySiteCreate) -> WeeklySite:
        workspace = await self.workspace(owner_id)
        polygon = normalize_geometry(payload.geometry)
        state_code = payload.state_code.upper()
        validate_in_state(polygon, state_code)
        longitude, latitude = polygon_centroid(polygon)
        timezone_name = payload.timezone or _infer_timezone(state_code, longitude, latitude)
        try:
            ZoneInfo(timezone_name)
        except (KeyError, ValueError) as exc:
            raise ValueError("timezone must be a valid IANA time zone") from exc
        site_id = f"site-{uuid.uuid4().hex[:12]}"
        site = WeeklySite(
            site_id=site_id,
            owner_id=owner_id,
            name=payload.name,
            state_code=state_code,
            site_type=payload.site_type,
            geometry=polygon,
            centroid=GeoPoint(longitude=longitude, latitude=latitude),
            timezone=timezone_name,
            curated=False,
            data_status=DataStatus.UNAVAILABLE,
            source_label="No environmental evidence has been provisioned",
        )
        workspace.sites[site_id] = SiteRecord(site=site, crews=[], jobs=[], days=[])
        await self.save(owner_id)
        return site

    async def clone_curated_for_live_week(self, owner_id: str, site_id: str) -> SiteRecord:
        workspace = await self.workspace(owner_id)
        source = await self.site_record(owner_id, site_id)
        if not source.site.curated:
            return source
        new_site_id = f"site-{uuid.uuid4().hex[:12]}"
        day_shift = workspace.state.week_start - (source.site.evidence_week_start or DEFAULT_WEEK_START)
        crew_ids = {crew.crew_id: f"{new_site_id}-crew-{index + 1}" for index, crew in enumerate(source.crews)}
        job_ids = {job.job_id: f"{new_site_id}-job-{index + 1}" for index, job in enumerate(source.jobs)}
        site = source.site.model_copy(update={
            "site_id": new_site_id,
            "owner_id": owner_id,
            "name": f"{source.site.name} · private week",
            "curated": False,
            "data_status": DataStatus.UNAVAILABLE,
            "evidence_week_start": None,
            "source_label": "Private operational copy · environmental evidence not yet provisioned",
            "thermal_burden": None,
        })
        crews = [crew.model_copy(update={"crew_id": crew_ids[crew.crew_id], "site_id": new_site_id}) for crew in source.crews]
        jobs = [job.model_copy(update={
            "job_id": job_ids[job.job_id],
            "site_id": new_site_id,
            "assigned_crew_id": crew_ids[job.assigned_crew_id],
            "eligible_crew_ids": [crew_ids[value] for value in job.eligible_crew_ids],
            "dependencies": [job_ids[value] for value in job.dependencies],
            "original_start": job.original_start + day_shift,
            "earliest_start": job.earliest_start + day_shift,
            "latest_finish": job.latest_finish + day_shift,
        }) for job in source.jobs]
        record = SiteRecord(site=site, crews=crews, jobs=jobs, days=[])
        workspace.sites[new_site_id] = record
        await self.save(owner_id)
        return record

    async def site_record(self, owner_id: str, site_id: str) -> SiteRecord:
        workspace = await self.workspace(owner_id)
        try:
            return workspace.sites[site_id]
        except KeyError as exc:
            raise KeyError("site not found in this workspace") from exc

    async def site_workspace(self, owner_id: str, site_id: str) -> SiteWorkspace:
        workspace = await self.workspace(owner_id)
        record = await self.site_record(owner_id, site_id)
        site = record.site.model_copy(deep=True)
        days = record.days if site.evidence_week_start == workspace.state.week_start else []
        if not days:
            site.data_status = DataStatus.UNAVAILABLE
            site.thermal_burden = None
            site.source_label = "No evidence for the selected week"
        return SiteWorkspace(
            site=site,
            crews=record.crews,
            jobs=record.jobs,
            days=days,
            analysis=record.analysis if days else None,
        )

    async def patch_site(self, owner_id: str, site_id: str, patch: dict[str, Any]) -> WeeklySite:
        record = await self.site_record(owner_id, site_id)
        allowed = {"name", "site_type", "timezone"}
        if set(patch) - allowed:
            raise ValueError("only site name and type can be edited after creation")
        if "name" in patch:
            record.site.name = str(patch["name"]).strip()
        if "site_type" in patch:
            record.site.site_type = str(patch["site_type"]).strip()
        if "timezone" in patch:
            timezone_name = str(patch["timezone"]).strip()
            try:
                ZoneInfo(timezone_name)
            except (KeyError, ValueError) as exc:
                raise ValueError("timezone must be a valid IANA time zone") from exc
            record.site.timezone = timezone_name
        await self.save(owner_id)
        return record.site

    async def delete_site(self, owner_id: str, site_id: str) -> None:
        workspace = await self.workspace(owner_id)
        record = await self.site_record(owner_id, site_id)
        if record.site.curated:
            raise ValueError("curated sites are shared evidence and cannot be deleted")
        del workspace.sites[site_id]
        await self.save(owner_id)

    async def create_crew(self, owner_id: str, site_id: str, payload: WeeklyCrewCreate) -> WeeklyCrew:
        record = await self.site_record(owner_id, site_id)
        crew = WeeklyCrew(crew_id=f"crew-{uuid.uuid4().hex[:10]}", site_id=site_id, **payload.model_dump())
        record.crews.append(crew)
        record.analysis = None
        await self.save(owner_id)
        return crew

    async def patch_crew(self, owner_id: str, site_id: str, crew_id: str, patch: dict[str, Any]) -> WeeklyCrew:
        record = await self.site_record(owner_id, site_id)
        crew = next((item for item in record.crews if item.crew_id == crew_id), None)
        if not crew:
            raise KeyError("crew not found")
        revised = WeeklyCrew.model_validate({**crew.model_dump(), **patch})
        record.crews[record.crews.index(crew)] = revised
        record.analysis = None
        await self.save(owner_id)
        return revised

    async def delete_crew(self, owner_id: str, site_id: str, crew_id: str) -> None:
        record = await self.site_record(owner_id, site_id)
        if any(crew_id in job.eligible_crew_ids for job in record.jobs):
            raise ValueError("crew is assigned or eligible for an existing job")
        record.crews = [crew for crew in record.crews if crew.crew_id != crew_id]
        record.analysis = None
        await self.save(owner_id)

    async def create_job(self, owner_id: str, site_id: str, payload: WeeklyJobCreate) -> WeeklyJob:
        workspace = await self.workspace(owner_id)
        record = await self.site_record(owner_id, site_id)
        self._validate_job(record, payload, workspace.state.week_start)
        job = WeeklyJob(job_id=f"job-{uuid.uuid4().hex[:10]}", site_id=site_id, **payload.model_dump())
        record.jobs.append(job)
        self._validate_graph(record.jobs)
        record.analysis = None
        await self.save(owner_id)
        return job

    async def patch_job(self, owner_id: str, site_id: str, job_id: str, patch: dict[str, Any]) -> WeeklyJob:
        workspace = await self.workspace(owner_id)
        record = await self.site_record(owner_id, site_id)
        job = next((item for item in record.jobs if item.job_id == job_id), None)
        if not job:
            raise KeyError("job not found")
        if job.status in {JobStatus.COMPLETED, JobStatus.IN_PROGRESS} and any(key != "status" for key in patch):
            raise ValueError("completed and in-progress jobs are locked")
        if job.status == JobStatus.COMPLETED and patch.get("status") not in {None, JobStatus.COMPLETED, "completed"}:
            raise ValueError("completed jobs cannot be reopened")
        if patch.get("status") in {JobStatus.CANCELLED, "cancelled"} and any(
            job_id in dependent.dependencies and dependent.status != JobStatus.CANCELLED
            for dependent in record.jobs
        ):
            raise ValueError("a prerequisite job cannot be cancelled while active dependent jobs remain")
        revised = WeeklyJob.model_validate({**job.model_dump(), **patch})
        self._validate_job(record, revised, workspace.state.week_start)
        prospective = [revised if item.job_id == job_id else item for item in record.jobs]
        self._validate_graph(prospective)
        record.jobs = prospective
        record.analysis = None
        await self.save(owner_id)
        return revised

    async def delete_job(self, owner_id: str, site_id: str, job_id: str) -> None:
        record = await self.site_record(owner_id, site_id)
        selected = next((job for job in record.jobs if job.job_id == job_id), None)
        if selected is None:
            raise KeyError("job not found")
        if selected.status in {JobStatus.COMPLETED, JobStatus.IN_PROGRESS}:
            raise ValueError("completed and in-progress jobs are locked")
        if any(job_id in job.dependencies for job in record.jobs):
            raise ValueError("remove dependent links before deleting this job")
        record.jobs = [job for job in record.jobs if job.job_id != job_id]
        record.analysis = None
        await self.save(owner_id)

    async def optimize(self, owner_id: str, site_id: str) -> WeeklyAnalysis:
        workspace = await self.workspace(owner_id)
        record = await self.site_record(owner_id, site_id)
        if record.site.evidence_week_start != workspace.state.week_start or not record.days:
            raise ValueError("this site has no environmental evidence for the selected week")
        crews = {crew.crew_id: crew for crew in record.crews}
        if not record.jobs or not crews:
            raise ValueError("add at least one crew and one job before analysis")
        original = entries_for(record.jobs, crews, record.days, PlanLayer.ORIGINAL)
        heatshift = self._optimizer.optimize(record.jobs, crews, record.days)
        metrics = calculate_weekly_metrics(record.days, record.jobs, crews, original, heatshift)
        original_metrics = calculate_weekly_metrics(record.days, record.jobs, crews, original, original)
        record.analysis = WeeklyAnalysis(
            analysis_id=str(uuid.uuid4()),
            site_id=site_id,
            week_start=workspace.state.week_start,
            policy_version="heatshift-screening-v2.0",
            original=original,
            heatshift=heatshift,
            working=[entry.model_copy(update={"source": PlanLayer.WORKING}) for entry in heatshift],
            plan_metrics={
                PlanLayer.ORIGINAL: original_metrics,
                PlanLayer.HEATSHIFT: metrics,
                PlanLayer.WORKING: metrics,
            },
            metrics=metrics,
            explanations=_plan_explanations(metrics, metrics),
            recommendations=_recommendations(metrics),
            limitations=[
                "Screening-level planning support only; use an on-site WBGT meter and qualified safety professional.",
                "Environmental evidence is not a worker-worn or building sensor reading.",
                "A score of 50 is a disclosed product threshold, not a universal safety limit.",
                "The deterministic scheduler returns a validated feasible plan, not a proven global optimum.",
            ],
            briefing_markdown=_briefing(record.site.name, metrics),
            briefing_mode="deterministic_fallback",
        )
        record.analysis.briefing_markdown, record.analysis.briefing_mode = await generate_weekly_briefing(
            record.analysis, record.site.name
        )
        await self.save(owner_id)
        return record.analysis

    async def patch_working_plan(self, owner_id: str, site_id: str, payload: WorkingPlanPatch) -> WeeklyAnalysis:
        record = await self.site_record(owner_id, site_id)
        if not record.analysis:
            raise ValueError("run optimization before editing the working plan")
        jobs = {job.job_id: job for job in record.jobs}
        crews = {crew.crew_id: crew for crew in record.crews}
        # Treat the browser payload as a requested start/crew only. Duration, score,
        # source and end time are recomputed from authoritative domain inputs.
        submitted = [entry.model_copy(update={"source": PlanLayer.WORKING}) for entry in payload.entries]
        errors = validate_schedule(submitted, record.jobs)
        if errors:
            raise ValueError(errors[0])
        entries = [
            entry_for(jobs[entry.job_id], crews[entry.crew_id], entry.start, PlanLayer.WORKING, record.days)
            for entry in submitted
        ]
        metrics = calculate_weekly_metrics(record.days, record.jobs, crews, record.analysis.original, entries)
        record.analysis.working = entries
        if not record.analysis.plan_metrics:
            record.analysis.plan_metrics = {
                PlanLayer.ORIGINAL: calculate_weekly_metrics(
                    record.days, record.jobs, crews, record.analysis.original, record.analysis.original
                ),
                PlanLayer.HEATSHIFT: calculate_weekly_metrics(
                    record.days, record.jobs, crews, record.analysis.original, record.analysis.heatshift
                ),
            }
        record.analysis.plan_metrics[PlanLayer.WORKING] = metrics
        record.analysis.metrics = metrics
        heatshift_metrics = record.analysis.plan_metrics.get(PlanLayer.HEATSHIFT, metrics)
        record.analysis.explanations = _plan_explanations(heatshift_metrics, metrics)
        record.analysis.briefing_markdown = _briefing(record.site.name, metrics)
        await self.save(owner_id)
        return record.analysis

    @staticmethod
    def _validate_job(record: SiteRecord, payload: WeeklyJobCreate, week_start: date) -> None:
        crew_ids = {crew.crew_id for crew in record.crews}
        if payload.assigned_crew_id not in crew_ids or not set(payload.eligible_crew_ids).issubset(crew_ids):
            raise ValueError("job references a crew outside this site")
        if not point_in_feature_collection(payload.location.longitude, payload.location.latitude, record.site.geometry):
            raise ValueError("job location must remain inside the site")
        zone = ZoneInfo(record.site.timezone)
        start_date = payload.earliest_start.astimezone(zone).date()
        original_date = payload.original_start.astimezone(zone).date()
        finish_date = payload.latest_finish.astimezone(zone).date()
        week_end = week_start + timedelta(days=6)
        if start_date < week_start or original_date < week_start or original_date > week_end or finish_date > week_end:
            raise ValueError("job date/time window must remain inside the selected seven-day week")

    @staticmethod
    def _validate_graph(jobs: list[WeeklyJob]) -> None:
        jobs_by_id = {job.job_id: job for job in jobs}
        if any(not set(job.dependencies).issubset(jobs_by_id) for job in jobs):
            raise ValueError("job dependency references an unknown job")
        visiting: set[str] = set()
        visited: set[str] = set()
        def visit(job_id: str) -> None:
            if job_id in visiting:
                raise ValueError("job dependencies must not contain a cycle")
            if job_id in visited:
                return
            visiting.add(job_id)
            for dependency in jobs_by_id[job_id].dependencies:
                visit(dependency)
            visiting.remove(job_id)
            visited.add(job_id)
        for job_id in jobs_by_id:
            visit(job_id)


def _infer_timezone(state_code: str, longitude: float, latitude: float) -> str:
    # Coordinate-aware handling for states split by common US time-zone borders.
    if state_code == "TX" and longitude < -103.0:
        return "America/Denver"
    if state_code == "FL" and longitude < -85.0:
        return "America/Chicago"
    if state_code in {"ND", "SD", "NE", "KS"} and longitude < -101.0:
        return "America/Denver"
    if state_code == "ID" and latitude > 45.7 and longitude < -114.3:
        return "America/Los_Angeles"
    if state_code == "OR" and longitude > -117.5:
        return "America/Boise"
    if state_code in {"KY", "TN"} and longitude < -85.6:
        return "America/Chicago"
    if state_code == "IN" and longitude < -87.0:
        return "America/Chicago"
    if state_code in {"CA", "NV", "OR", "WA"}:
        return "America/Los_Angeles"
    if state_code in {"AZ", "CO", "ID", "MT", "NM", "UT", "WY"}:
        return "America/Phoenix" if state_code == "AZ" else "America/Denver"
    if state_code in {"AL", "AR", "IA", "IL", "KS", "LA", "MN", "MO", "MS", "ND", "NE", "OK", "SD", "TN", "TX", "WI"}:
        return "America/Chicago"
    if state_code == "AK":
        return "America/Anchorage"
    if state_code == "HI":
        return "Pacific/Honolulu"
    return "America/New_York"


def _recommendations(metrics) -> list[str]:
    recommendations = []
    if metrics.tasks_rescheduled:
        recommendations.append(f"Review {metrics.tasks_rescheduled} proposed time change(s) before applying them.")
    if metrics.residual_alerts:
        recommendations.append(f"Keep controls in place for {metrics.residual_alerts} task(s) still at or above score 50.")
    if metrics.crew_load_spread > 2:
        recommendations.append("Check whether eligible crew reassignment can reduce the crew-load spread.")
    return recommendations or ["No schedule movement is justified by the current inputs; retain controls and monitor conditions."]


def _plan_explanations(heatshift_metrics, working_metrics):
    explanations = metric_explanations(working_metrics)
    explanations["crew_load"].inputs = {
        "original": working_metrics.original_crew_exposure_load,
        "heatshift": heatshift_metrics.proposed_crew_exposure_load,
        "working": working_metrics.proposed_crew_exposure_load,
    }
    explanations["crew_load"].comparison = (
        f"Original {working_metrics.original_crew_exposure_load:.2f} → "
        f"HeatShift {heatshift_metrics.proposed_crew_exposure_load:.2f} → "
        f"Working {working_metrics.proposed_crew_exposure_load:.2f} risk-weighted worker-hours."
    )
    explanations["risk_reduction"].inputs = {
        "original_worker_minutes": working_metrics.original_exposure_worker_minutes,
        "heatshift_worker_minutes": heatshift_metrics.proposed_exposure_worker_minutes,
        "working_worker_minutes": working_metrics.proposed_exposure_worker_minutes,
        "threshold": 50,
    }
    explanations["risk_reduction"].comparison = (
        f"HeatShift {heatshift_metrics.risk_reduction_percent:.1f}% lower; "
        f"Working {working_metrics.risk_reduction_percent:.1f}% lower than Original at score 50."
    )
    explanations["disruption"].inputs = {
        "heatshift": heatshift_metrics.disruption.model_dump(),
        "working": working_metrics.disruption.model_dump(),
    }
    explanations["disruption"].comparison = (
        f"HeatShift shifts {heatshift_metrics.disruption.total_minutes_shifted} minutes; "
        f"Working shifts {working_metrics.disruption.total_minutes_shifted} minutes."
    )
    return explanations


def _briefing(site_name: str, metrics) -> str:
    return (
        "## Decision\n\n"
        f"Review the HeatShift plan for **{site_name}**. It reschedules **{metrics.tasks_rescheduled}** job(s) "
        f"and reduces score-50 exposure by **{metrics.risk_reduction_percent:.1f}%** while retaining "
        f"**{metrics.productive_task_time_retained_percent:.1f}%** of submitted task time.\n\n"
        "## Why\n\n"
        f"Site Thermal Burden is **{metrics.site_thermal_burden_degree_hours:.1f} degree-hours**. "
        f"Crew Exposure Load changes from **{metrics.original_crew_exposure_load:.2f}** to "
        f"**{metrics.proposed_crew_exposure_load:.2f} risk-weighted worker-hours**.\n\n"
        "## Next actions\n\n"
        f"- Check the **{metrics.disruption.total_minutes_shifted} shifted minutes** against delivery and access constraints.\n"
        "- Confirm crew availability and recovery controls before applying any movement.\n"
        "- Apply the whole proposal or individual changes to the Working plan.\n\n"
        "## Still exposed\n\n"
        f"**{metrics.residual_alerts}** task(s) remain at or above the screening threshold. "
        "HeatShift supports planning; it does not replace on-site WBGT measurement or qualified safety judgment."
    )


weekly_store = WeeklyStore()
weekly_state_options = state_options()
