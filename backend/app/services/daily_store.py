from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from ..config import ROOT_DIR
from ..models.daily import (
    DailyAnalysis,
    DailyEvidence,
    DailySite,
    DailySiteCreate,
    DailyWorkspace,
    EvidenceKind,
    PlanLayer,
    SimulationRequest,
    SimulationSummary,
    WorkflowStage,
)
from ..models.site import GeoPoint
from .daily_analysis import (
    calculate_metrics,
    daily_optimizer,
    entries_for,
    metric_explanations,
    site_thermal_burden,
)
from .daily_simulator import daily_simulator, simulated_evidence
from .state_catalog import (
    circle_feature_collection,
    normalize_geometry,
    polygon_centroid,
    state_options,
    validate_in_state,
)


CURATED_DAILY_SITES = [
    {
        "site_id": "desertline-phoenix",
        "name": "DesertLine Logistics Yard",
        "state_code": "AZ",
        "site_type": "Logistics yard",
        "longitude": -112.0675,
        "latitude": 33.4515,
        "timezone": "America/Phoenix",
        "date": date(2024, 7, 18),
        "seed": 1042,
    },
    {
        "site_id": "gulfgate-houston",
        "name": "GulfGate Container Terminal",
        "state_code": "TX",
        "site_type": "Container terminal",
        "longitude": -95.2580,
        "latitude": 29.7420,
        "timezone": "America/Chicago",
        "date": date(2024, 7, 17),
        "seed": 2042,
    },
    {
        "site_id": "sungrid-miami",
        "name": "SunGrid Utility Response Zone",
        "state_code": "FL",
        "site_type": "Utility response zone",
        "longitude": -80.2150,
        "latitude": 25.7800,
        "timezone": "America/New_York",
        "date": date(2024, 7, 20),
        "seed": 3042,
    },
]


@dataclass
class DailyRecord:
    site: DailySite
    evidence: DailyEvidence | None = None
    crews: list = None  # type: ignore[assignment]
    jobs: list = None  # type: ignore[assignment]
    simulation: SimulationSummary | None = None
    analysis: DailyAnalysis | None = None

    def __post_init__(self) -> None:
        self.crews = self.crews or []
        self.jobs = self.jobs or []


def _cached_day(config: dict[str, Any]) -> DailyEvidence:
    path = ROOT_DIR / "data" / "curated" / config["site_id"] / "week-2024-07-15.json"
    raw = path.read_bytes()
    payload = json.loads(raw)
    selected = next(item for item in payload["days"] if item["date"] == config["date"].isoformat())
    selected["integrity_sha256"] = hashlib.sha256(raw).hexdigest()
    return DailyEvidence.model_validate(selected)


def _timezone_for(state_code: str, longitude: float, latitude: float) -> str:
    if state_code == "AK":
        return "America/Anchorage"
    if state_code == "HI":
        return "Pacific/Honolulu"
    if state_code == "AZ":
        return "America/Phoenix"
    if state_code == "TX" and longitude < -103:
        return "America/Denver"
    if state_code == "FL" and longitude < -85:
        return "America/Chicago"
    if state_code in {"CA", "NV", "OR", "WA"}:
        return "America/Los_Angeles"
    if state_code in {"CO", "ID", "MT", "NM", "UT", "WY"}:
        return "America/Denver"
    if state_code in {"AL", "AR", "IA", "IL", "KS", "LA", "MN", "MO", "MS", "ND", "NE", "OK", "SD", "TN", "TX", "WI"}:
        return "America/Chicago"
    return "America/New_York"


class DailyStore:
    def __init__(self) -> None:
        self._workspaces: dict[str, dict[str, DailyRecord]] = {}
        self._lock = asyncio.Lock()

    async def workspace(self, owner_id: str) -> dict[str, DailyRecord]:
        async with self._lock:
            if owner_id not in self._workspaces:
                self._workspaces[owner_id] = await self._default_records()
            return self._workspaces[owner_id]

    async def reset(self, owner_id: str) -> list[DailySite]:
        """Replace one anonymous daily workspace with pristine curated defaults."""
        defaults = await self._default_records()
        async with self._lock:
            self._workspaces[owner_id] = defaults
        return sorted(
            (record.site.model_copy(deep=True) for record in defaults.values()),
            key=lambda item: item.name,
        )

    async def _default_records(self) -> dict[str, DailyRecord]:
        records: dict[str, DailyRecord] = {}
        for config in CURATED_DAILY_SITES:
            evidence = _cached_day(config)
            site = DailySite(
                site_id=config["site_id"],
                name=config["name"],
                state_code=config["state_code"],
                site_type=config["site_type"],
                operation_date=config["date"],
                geometry=circle_feature_collection(config["longitude"], config["latitude"], 600),
                centroid=GeoPoint(longitude=config["longitude"], latitude=config["latitude"]),
                timezone=config["timezone"],
                curated=True,
                workflow_stage=WorkflowStage.SIMULATION_READY,
                evidence_kind=EvidenceKind.FORTYGUARD_CACHED,
                source_label=f"Cached FortyGuard day · {config['date'].isoformat()} · SHA-256 {evidence.integrity_sha256[:12]}…",
                thermal_burden=site_thermal_burden(evidence),
            )
            request = SimulationRequest(seed=config["seed"], crew_count=8, jobs_per_crew=5)
            crews, jobs, simulation = await daily_simulator.generate(site, request, use_ai=False)
            record = DailyRecord(site=site, evidence=evidence, crews=crews, jobs=jobs, simulation=simulation)
            record.analysis = self._analyze(record)
            record.site.workflow_stage = WorkflowStage.ANALYZED
            records[site.site_id] = record
        return records

    async def list_sites(self, owner_id: str, state_code: str | None = None) -> list[DailySite]:
        workspace = await self.workspace(owner_id)
        sites = [record.site for record in workspace.values()]
        if state_code:
            sites = [site for site in sites if site.state_code == state_code.upper()]
        return sorted((site.model_copy(deep=True) for site in sites), key=lambda item: item.name)

    async def record(self, owner_id: str, site_id: str) -> DailyRecord:
        workspace = await self.workspace(owner_id)
        if site_id not in workspace:
            raise KeyError("site not found in this workspace")
        return workspace[site_id]

    async def site(self, owner_id: str, site_id: str) -> DailyWorkspace:
        record = await self.record(owner_id, site_id)
        return DailyWorkspace(
            site=record.site,
            evidence=record.evidence,
            crews=record.crews,
            jobs=record.jobs,
            simulation=record.simulation,
            analysis=record.analysis,
        )

    async def create_site(self, owner_id: str, payload: DailySiteCreate) -> DailySite:
        if payload.operation_date < date(2019, 1, 1) or payload.operation_date > date.today():
            raise ValueError("operation date must be between January 1, 2019 and today")
        polygon = normalize_geometry(payload.geometry)
        state_code = payload.state_code.upper()
        validate_in_state(polygon, state_code)
        longitude, latitude = polygon_centroid(polygon)
        timezone_name = payload.timezone or _timezone_for(state_code, longitude, latitude)
        try:
            ZoneInfo(timezone_name)
        except (KeyError, ValueError) as exc:
            raise ValueError("timezone must be a valid IANA time zone") from exc
        site = DailySite(
            site_id=f"site-{uuid.uuid4().hex[:12]}",
            owner_id=owner_id,
            name=payload.name,
            state_code=state_code,
            site_type=payload.site_type,
            operation_date=payload.operation_date,
            geometry=polygon,
            centroid=GeoPoint(longitude=longitude, latitude=latitude),
            timezone=timezone_name,
            curated=False,
            workflow_stage=WorkflowStage.SITE_CREATED,
            evidence_kind=EvidenceKind.SIMULATED_LOCAL,
            source_label="Local build: weather profile has not been generated yet",
        )
        workspace = await self.workspace(owner_id)
        workspace[site.site_id] = DailyRecord(site=site)
        return site

    async def generate(
        self, owner_id: str, site_id: str, request: SimulationRequest
    ) -> DailyWorkspace:
        record = await self.record(owner_id, site_id)
        if not record.site.curated:
            record.evidence = simulated_evidence(record.site, request.seed)
            record.site.source_label = "Locally simulated hourly weather and heat field · not provider evidence"
            record.site.thermal_burden = site_thermal_burden(record.evidence)
        if record.evidence is None:
            raise ValueError("environmental conditions are unavailable")
        record.crews, record.jobs, record.simulation = await daily_simulator.generate(record.site, request)
        record.analysis = None
        record.site.workflow_stage = WorkflowStage.SIMULATION_READY
        return await self.site(owner_id, site_id)

    async def analyze(self, owner_id: str, site_id: str) -> DailyAnalysis:
        record = await self.record(owner_id, site_id)
        if not record.evidence or not record.crews or not record.jobs or not record.simulation:
            raise ValueError("generate the daily simulation before running analysis")
        record.analysis = self._analyze(record)
        record.site.workflow_stage = WorkflowStage.ANALYZED
        return record.analysis

    async def delete(self, owner_id: str, site_id: str) -> None:
        workspace = await self.workspace(owner_id)
        record = await self.record(owner_id, site_id)
        if record.site.curated:
            raise ValueError("the three built-in examples cannot be deleted")
        del workspace[site_id]

    @staticmethod
    def _analyze(record: DailyRecord) -> DailyAnalysis:
        assert record.evidence is not None
        crews = {crew.crew_id: crew for crew in record.crews}
        original = entries_for(record.jobs, crews, record.evidence, PlanLayer.ORIGINAL)
        proposed = daily_optimizer.optimize(record.jobs, crews, record.evidence)
        metrics = calculate_metrics(record.evidence, record.jobs, crews, original, proposed)
        recommendations = []
        if metrics.tasks_rescheduled:
            recommendations.append(f"Review {metrics.tasks_rescheduled} proposed time changes before adopting the plan.")
        if metrics.residual_alerts:
            recommendations.append(f"Keep controls in place for {metrics.residual_alerts} jobs still at or above score 50.")
        if metrics.crew_load_spread > 8:
            recommendations.append("Review the highest-loaded crew and eligible reassignments before work starts.")
        return DailyAnalysis(
            analysis_id=str(uuid.uuid4()),
            site_id=record.site.site_id,
            operation_date=record.site.operation_date,
            policy_version="heatshift-daily-screening-v1.0",
            original=original,
            heatshift=proposed,
            metrics=metrics,
            explanations=metric_explanations(metrics),
            recommendations=recommendations,
            limitations=[
                "Screening-level planning support only; verify conditions on site and use qualified safety judgment.",
                "Operational crews and jobs are fictional simulation inputs.",
                "A score of 50 and the 35°C burden baseline are disclosed product thresholds, not universal safety limits.",
                "The scheduler returns a validated feasible improvement, not a proven global optimum.",
            ],
            briefing_markdown=_briefing(record.site, metrics),
        )


def _briefing(site: DailySite, metrics) -> str:
    return (
        "## Decision\n\n"
        f"Review the proposed day plan for **{site.name}**. HeatShift moves **{metrics.tasks_rescheduled} jobs** "
        f"and reduces score-50 exposure by **{metrics.risk_reduction_percent:.1f}%**.\n\n"
        "## What changed\n\n"
        f"High-risk exposure changes from **{metrics.original_exposure_worker_minutes}** to "
        f"**{metrics.proposed_exposure_worker_minutes} worker-minutes**. Crew Exposure Load changes from "
        f"**{metrics.original_crew_exposure_load:.2f}** to **{metrics.proposed_crew_exposure_load:.2f}**.\n\n"
        "## Operational cost\n\n"
        f"The plan shifts **{metrics.disruption.total_minutes_shifted} minutes** in total and makes "
        f"**{metrics.disruption.crew_reassignments} crew reassignments**. Every fixed job and task duration is preserved.\n\n"
        "## Still exposed\n\n"
        f"**{metrics.residual_alerts} jobs** remain at or above the screening threshold. Keep recovery, hydration, "
        "work/rest and on-site measurement controls in the manager's decision."
    )


daily_store = DailyStore()
daily_state_options = state_options()
