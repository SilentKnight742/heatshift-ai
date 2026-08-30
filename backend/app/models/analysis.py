from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from .crew import Crew
from .site import Site
from .task import Task
from .weather import DataProvenance, EnvironmentalObservation


class AnalysisStatus(StrEnum):
    QUEUED = "queued"
    FETCHING_HEAT = "fetching_heat"
    CALCULATING_RISK = "calculating_risk"
    OPTIMIZING = "optimizing"
    COMPLETED = "completed"
    FAILED = "failed"


class RiskFactor(BaseModel):
    name: str
    points: int
    detail: str


class RiskReading(BaseModel):
    score: int = Field(ge=0, le=100)
    band: str
    factors: list[RiskFactor]


class ScheduleItem(BaseModel):
    task_id: str
    task_name: str
    crew_id: str
    crew_name: str
    worker_count: int
    workload: str
    start: datetime
    end: datetime
    movable: bool
    shaded: bool
    average_risk: float
    peak_risk: int
    peak_band: str
    exposed_worker_minutes: int
    risk_factors: list[RiskFactor]


class Movement(BaseModel):
    task_id: str
    task_name: str
    from_start: datetime
    to_start: datetime
    minutes_moved: int
    reason: str


class Metrics(BaseModel):
    peak_temperature_c: float
    peak_apparent_temperature_c: float
    maximum_screening_score: int
    highest_risk_task: str
    baseline_exposed_worker_minutes: int
    optimized_exposed_worker_minutes: int
    exposure_reduction_percent: float
    schedule_disruption_minutes: int
    productivity_retained_percent: float
    tasks_moved: int


class Recommendation(BaseModel):
    priority: str
    title: str
    detail: str
    evidence: str


class WorkerAlert(BaseModel):
    alert_id: str
    severity: str
    headline: str
    task_name: str
    crew_name: str
    message: str
    next_action: str
    hydration_check_due: bool = True


class ToolTrace(BaseModel):
    sequence: int
    tool: str
    arguments: dict[str, Any]
    latency_ms: float
    success: bool
    summary: str


class AgentOutput(BaseModel):
    mode: str
    explanation: str
    tool_trace: list[ToolTrace]
    evidence_references: list[str]
    alerts: list[WorkerAlert]


class AnalysisResult(BaseModel):
    analysis_id: str
    status: AnalysisStatus
    created_at: datetime
    completed_at: datetime
    site: Site
    crews: list[Crew]
    tasks: list[Task]
    heatmap_geojson: dict
    observations: list[EnvironmentalObservation]
    baseline_schedule: list[ScheduleItem]
    optimized_schedule: list[ScheduleItem]
    movements: list[Movement]
    metrics: Metrics
    recommendations: list[Recommendation]
    worker_alerts: list[WorkerAlert]
    data_provenance: DataProvenance
    policy_version: str
    limitations: list[str]
    agent: AgentOutput | None = None


class AnalysisJob(BaseModel):
    analysis_id: str
    status: AnalysisStatus
    created_at: datetime
    result: AnalysisResult | None = None
    error: str | None = None

