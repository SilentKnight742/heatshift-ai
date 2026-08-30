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
    tasks: list[Task] = Field(min_length=1, max_length=24)

    @model_validator(mode="after")
    def validate_tasks(self) -> "ShiftPlan":
        if self.shift_start.date() != self.date or self.shift_end.date() != self.date:
            raise ValueError("shift timestamps must match the declared shift date")
        if self.shift_start >= self.shift_end:
            raise ValueError("shift_end must be later than shift_start")
        ids = {task.task_id for task in self.tasks}
        if len(ids) != len(self.tasks):
            raise ValueError("task IDs must be unique")
        task_by_id = {task.task_id: task for task in self.tasks}
        for task in self.tasks:
            if any(timestamp.date() != self.date for timestamp in (task.scheduled_start, task.earliest_start, task.latest_finish)):
                raise ValueError(f"task {task.task_id} timestamps must match the shift date")
            if not set(task.dependencies).issubset(ids):
                raise ValueError(f"unknown dependency for task {task.task_id}")
            if task.scheduled_start < self.shift_start or task.scheduled_end > self.shift_end:
                raise ValueError(f"task {task.task_id} falls outside the shift")
            for dependency_id in task.dependencies:
                dependency = task_by_id[dependency_id]
                if dependency.scheduled_end > task.scheduled_start:
                    raise ValueError(f"task {task.task_id} starts before dependency {dependency_id} finishes")

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(task_id: str) -> None:
            if task_id in visiting:
                raise ValueError("task dependencies must not contain a cycle")
            if task_id in visited:
                return
            visiting.add(task_id)
            for dependency_id in task_by_id[task_id].dependencies:
                visit(dependency_id)
            visiting.remove(task_id)
            visited.add(task_id)

        for task_id in ids:
            visit(task_id)

        tasks_by_crew: dict[str, list[Task]] = {}
        for task in self.tasks:
            tasks_by_crew.setdefault(task.crew_id, []).append(task)
        for crew_id, crew_tasks in tasks_by_crew.items():
            ordered = sorted(crew_tasks, key=lambda item: item.scheduled_start)
            for previous, current in zip(ordered, ordered[1:], strict=False):
                if previous.scheduled_end > current.scheduled_start:
                    raise ValueError(f"crew {crew_id} has overlapping baseline tasks")
        return self
