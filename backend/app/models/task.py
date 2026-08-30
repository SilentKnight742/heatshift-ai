from __future__ import annotations

from datetime import date, datetime, timedelta
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .site import GeoPoint


class Workload(StrEnum):
    LIGHT = "light"
    MODERATE = "moderate"
    HEAVY = "heavy"
    VERY_HEAVY = "very_heavy"


class Task(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    name: str
    crew_id: str
    location: GeoPoint
    duration_minutes: int = Field(gt=0, le=720)
    workload: Workload
    scheduled_start: datetime
    earliest_start: datetime
    latest_finish: datetime
    movable: bool
    dependencies: list[str] = Field(default_factory=list)
    shaded: bool = False

    @property
    def scheduled_end(self) -> datetime:
        return self.scheduled_start + timedelta(minutes=self.duration_minutes)

    @model_validator(mode="after")
    def validate_window(self) -> "Task":
        if self.scheduled_start < self.earliest_start:
            raise ValueError("scheduled_start precedes earliest_start")
        if self.scheduled_end > self.latest_finish:
            raise ValueError("task ends after latest_finish")
        return self


class ShiftPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shift_id: str
    date: date
    timezone: str
    shift_start: datetime
    shift_end: datetime
    tasks: list[Task]

    @model_validator(mode="after")
    def validate_tasks(self) -> "ShiftPlan":
        ids = {task.task_id for task in self.tasks}
        if len(ids) != len(self.tasks):
            raise ValueError("task IDs must be unique")
        for task in self.tasks:
            if not set(task.dependencies).issubset(ids):
                raise ValueError(f"unknown dependency for task {task.task_id}")
            if task.scheduled_start < self.shift_start or task.scheduled_end > self.shift_end:
                raise ValueError(f"task {task.task_id} falls outside the shift")
        return self

