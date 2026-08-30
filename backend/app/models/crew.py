from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class AcclimatizationStatus(StrEnum):
    NEW = "new"
    RETURNING = "returning"
    ACCLIMATIZED = "acclimatized"


class PPELevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Crew(BaseModel):
    model_config = ConfigDict(extra="forbid")

    crew_id: str
    name: str
    worker_count: int = Field(gt=0, le=100)
    acclimatization_status: AcclimatizationStatus
    ppe_level: PPELevel
    default_workload: str

