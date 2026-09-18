from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .crew import AcclimatizationStatus, PPELevel
from .site import GeoPoint
from .task import Workload


class WorkflowStage(StrEnum):
    SITE_CREATED = "site_created"
    SIMULATION_READY = "simulation_ready"
    ANALYZED = "analyzed"


class EvidenceKind(StrEnum):
    FORTYGUARD_CACHED = "fortyguard_cached"
    SIMULATED_LOCAL = "simulated_local"


class PlanLayer(StrEnum):
    ORIGINAL = "original"
    HEATSHIFT = "heatshift"


class GeometryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["polygon", "circle", "coordinates"]
    polygon: dict[str, Any] | None = None
    latitude: float | None = Field(default=None, ge=18.0, le=72.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=-66.0)
    radius_m: float | None = Field(default=None, gt=0, le=5000)

    @model_validator(mode="after")
    def validate_shape(self) -> "GeometryInput":
        if self.type == "polygon" and self.polygon is None:
            raise ValueError("polygon geometry is required")
        if self.type in {"circle", "coordinates"} and (
            self.latitude is None or self.longitude is None or self.radius_m is None
        ):
            raise ValueError("latitude, longitude and radius are required")
        return self


class DailySiteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=100)
    state_code: str = Field(min_length=2, max_length=2)
    site_type: str = Field(default="outdoor worksite", min_length=2, max_length=80)
    operation_date: date
    geometry: GeometryInput
    timezone: str | None = None


class DailySite(BaseModel):
    site_id: str
    owner_id: str | None = None
    name: str
    state_code: str
    site_type: str
    operation_date: date
    geometry: dict[str, Any]
    centroid: GeoPoint
    timezone: str
    curated: bool
    workflow_stage: WorkflowStage
    evidence_kind: EvidenceKind
    source_label: str
    thermal_burden: float | None = None


class DailyCrew(BaseModel):
    crew_id: str
    site_id: str
    name: str
    worker_count: int = Field(gt=0, le=100)
    acclimatization_status: AcclimatizationStatus
    ppe_level: PPELevel
    default_workload: Workload


class DailyJob(BaseModel):
    job_id: str
    site_id: str
    name: str
    location: GeoPoint
    duration_minutes: int = Field(gt=0, le=360, multiple_of=30)
    workload: Workload
    original_start: datetime
    earliest_start: datetime
    latest_finish: datetime
    assigned_crew_id: str
    eligible_crew_ids: list[str] = Field(min_length=1)
    movable: bool = True
    shaded: bool = False

    @model_validator(mode="after")
    def validate_window(self) -> "DailyJob":
        values = (self.original_start, self.earliest_start, self.latest_finish)
        if any(value.utcoffset() is None for value in values):
            raise ValueError("job times must include a time-zone offset")
        if len({value.date() for value in values}) != 1:
            raise ValueError("all job times must remain in one operation day")
        if self.original_start < self.earliest_start:
            raise ValueError("original_start precedes earliest_start")
        if self.original_start.timestamp() + self.duration_minutes * 60 > self.latest_finish.timestamp():
            raise ValueError("job ends after latest_finish")
        if self.assigned_crew_id not in self.eligible_crew_ids:
            raise ValueError("assigned crew must be eligible")
        return self


class HourlyCondition(BaseModel):
    timestamp: datetime
    temperature_c: float
    apparent_temperature_c: float
    wet_bulb_temperature_c: float
    relative_humidity_percent: float
    solar_irradiance_ghi_wm2: float
    source: Literal["FortyGuard", "HeatShift-derived", "simulated"]
    activity_id: str | None = None


class HeatCell(BaseModel):
    cell_id: str
    geometry: dict[str, Any]
    temperature_c_1500: float
    apparent_temperature_c: float
    source: Literal["FortyGuard", "HeatShift-derived", "simulated"]


class DailyEvidence(BaseModel):
    date: date
    conditions: list[HourlyCondition]
    heat_cells: list[HeatCell]
    satellite_context: dict[str, float] = Field(default_factory=dict)
    heatmap_activity_id: str | None = None
    environmental_activity_id: str | None = None
    integrity_sha256: str | None = None


class SimulationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seed: int = Field(default=42, ge=0, le=2_147_483_647)
    crew_count: int = Field(default=8, ge=4, le=12)
    jobs_per_crew: int = Field(default=5, ge=3, le=6)


class SimulationSummary(BaseModel):
    seed: int
    generation_mode: Literal["ai_enriched_stochastic", "deterministic_stochastic"]
    crew_count: int
    job_count: int
    worker_count: int
    fixed_job_count: int
    movable_job_count: int


class ScheduleEntry(BaseModel):
    job_id: str
    crew_id: str
    start: datetime
    end: datetime
    source: PlanLayer
    screening_score: int = Field(ge=0, le=100)


class DisruptionComponents(BaseModel):
    total_minutes_shifted: int = 0
    crew_reassignments: int = 0
    hard_constraint_violations: int = 0


class DailyMetrics(BaseModel):
    original_exposure_worker_minutes: int
    proposed_exposure_worker_minutes: int
    high_risk_hours_avoided: float
    risk_reduction_percent: float
    tasks_rescheduled: int
    fixed_tasks_preserved: int
    residual_alerts: int
    productive_task_time_retained_percent: float
    constraint_valid: bool
    site_thermal_burden_degree_hours: float
    original_crew_exposure_load: float
    proposed_crew_exposure_load: float
    highest_loaded_crew_id: str | None
    crew_load_spread: float
    disruption: DisruptionComponents


class MetricExplanation(BaseModel):
    metric: str
    definition: str
    formula: str
    inputs: dict[str, Any]
    source: str
    comparison: str
    limitations: list[str]


class DailyAnalysis(BaseModel):
    analysis_id: str
    site_id: str
    operation_date: date
    policy_version: str
    original: list[ScheduleEntry]
    heatshift: list[ScheduleEntry]
    metrics: DailyMetrics
    explanations: dict[str, MetricExplanation]
    recommendations: list[str]
    limitations: list[str]
    briefing_markdown: str


class DailyWorkspace(BaseModel):
    site: DailySite
    evidence: DailyEvidence | None
    crews: list[DailyCrew]
    jobs: list[DailyJob]
    simulation: SimulationSummary | None
    analysis: DailyAnalysis | None

