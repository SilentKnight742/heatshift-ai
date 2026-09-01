from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .crew import AcclimatizationStatus, PPELevel
from .site import GeoPoint
from .task import Workload


DEFAULT_WEEK_START = date(2024, 7, 15)


class DataStatus(StrEnum):
    READY = "ready"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"
    PROVISIONING = "provisioning"
    FAILED = "failed"


class JobStatus(StrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    DEFERRED = "deferred"


class PlanLayer(StrEnum):
    ORIGINAL = "original"
    HEATSHIFT = "heatshift"
    WORKING = "working"


class GeometryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["polygon", "circle", "coordinates"]
    polygon: dict[str, Any] | None = None
    latitude: float | None = Field(default=None, ge=24.0, le=50.0)
    longitude: float | None = Field(default=None, ge=-125.0, le=-66.0)
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


class WeeklySiteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=100)
    state_code: str = Field(min_length=2, max_length=2)
    site_type: str = Field(default="outdoor worksite", min_length=2, max_length=80)
    geometry: GeometryInput
    timezone: str | None = None


class WeeklySite(BaseModel):
    site_id: str
    owner_id: str | None = None
    name: str
    state_code: str
    site_type: str
    geometry: dict[str, Any]
    centroid: GeoPoint
    timezone: str
    curated: bool
    fictional_operation: bool = True
    data_status: DataStatus
    evidence_week_start: date | None = None
    source_label: str
    thermal_burden: float | None = None


class WeeklyCrewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=80)
    worker_count: int = Field(gt=0, le=100)
    acclimatization_status: AcclimatizationStatus
    ppe_level: PPELevel
    default_workload: Workload


class WeeklyCrew(WeeklyCrewCreate):
    crew_id: str
    site_id: str


class WeeklyJobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=100)
    location: GeoPoint
    duration_minutes: int = Field(gt=0, le=720, multiple_of=30)
    workload: Workload
    original_start: datetime
    earliest_start: datetime
    latest_finish: datetime
    assigned_crew_id: str
    eligible_crew_ids: list[str] = Field(min_length=1)
    dependencies: list[str] = Field(default_factory=list)
    movable: bool = True
    shaded: bool = False
    status: JobStatus = JobStatus.PENDING

    @model_validator(mode="after")
    def validate_window(self) -> "WeeklyJobCreate":
        for value in (self.original_start, self.earliest_start, self.latest_finish):
            if value.utcoffset() is None:
                raise ValueError("job times must include a time-zone offset")
        if self.original_start.minute % 30 or self.original_start.second or self.original_start.microsecond:
            raise ValueError("original_start must align to a 30-minute boundary")
        if self.original_start < self.earliest_start:
            raise ValueError("original_start precedes earliest_start")
        if self.original_start.timestamp() + self.duration_minutes * 60 > self.latest_finish.timestamp():
            raise ValueError("job ends after latest_finish")
        if self.assigned_crew_id not in self.eligible_crew_ids:
            raise ValueError("assigned crew must be eligible")
        return self


class WeeklyJob(WeeklyJobCreate):
    job_id: str
    site_id: str


class HourlyCondition(BaseModel):
    timestamp: datetime
    temperature_c: float
    apparent_temperature_c: float
    wet_bulb_temperature_c: float
    relative_humidity_percent: float
    solar_irradiance_ghi_wm2: float
    source: Literal["FortyGuard", "HeatShift-derived", "demonstration"]
    activity_id: str | None = None


class HeatCell(BaseModel):
    cell_id: str
    geometry: dict[str, Any]
    temperature_c_1500: float
    apparent_temperature_c: float
    source: Literal["FortyGuard", "HeatShift-derived", "demonstration"]


class SiteDay(BaseModel):
    date: date
    conditions: list[HourlyCondition]
    heat_cells: list[HeatCell]
    satellite_context: dict[str, float] = Field(default_factory=dict)
    heatmap_activity_id: str | None = None
    environmental_activity_id: str | None = None
    integrity_sha256: str | None = None


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
    cross_day_moves: int = 0
    manager_deferrals: int = 0
    cancellations: int = 0
    hard_constraint_violations: int = 0


class WeeklyMetrics(BaseModel):
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


class WeeklyAnalysis(BaseModel):
    analysis_id: str
    site_id: str
    week_start: date
    policy_version: str
    original: list[ScheduleEntry]
    heatshift: list[ScheduleEntry]
    working: list[ScheduleEntry]
    plan_metrics: dict[PlanLayer, WeeklyMetrics] = Field(default_factory=dict)
    metrics: WeeklyMetrics
    explanations: dict[str, MetricExplanation]
    recommendations: list[str]
    limitations: list[str]
    briefing_markdown: str
    briefing_mode: str


class SiteWorkspace(BaseModel):
    site: WeeklySite
    crews: list[WeeklyCrew]
    jobs: list[WeeklyJob]
    days: list[SiteDay]
    analysis: WeeklyAnalysis | None


class WorkspaceState(BaseModel):
    workspace_id: str
    week_start: date
    live_site_week_used: bool
    live_site_weeks_remaining: int
    walkthrough_completed: bool


class WorkingPlanPatch(BaseModel):
    entries: list[ScheduleEntry]


class QuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    context: dict[str, Any] = Field(default_factory=dict)


class QuestionResponse(BaseModel):
    answer_markdown: str
    mode: str
    remaining_today: int


class ProvisionRequest(BaseModel):
    turnstile_token: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=8, max_length=120)
    week_start: date


class ProvisionStatus(BaseModel):
    provisioning_id: str
    site_id: str
    state: Literal["validating", "reserved", "submitting", "polling", "ready", "degraded", "failed"]
    completed_stages: list[str]
    pending_stages: list[str]
    reserved_credits: int
    activity_ids: dict[str, str]
    error: str | None = None
