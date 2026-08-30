from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .crew import Crew
from .site import Site
from .task import ShiftPlan


class ScenarioAnalysisRequest(BaseModel):
    """A fictional operation analyzed against the pinned Phoenix evidence."""

    model_config = ConfigDict(extra="forbid")

    site: Site
    crews: list[Crew] = Field(min_length=1, max_length=8)
    shift: ShiftPlan
    environment_source: Literal["phoenix_reference"] = "phoenix_reference"

    @model_validator(mode="after")
    def validate_operation(self) -> "ScenarioAnalysisRequest":
        if self.site.site_id != "desertline-yard":
            raise ValueError("custom scenarios must use the pinned Phoenix reference footprint")
        crew_ids = {crew.crew_id for crew in self.crews}
        if len(crew_ids) != len(self.crews):
            raise ValueError("crew IDs must be unique")
        unknown_crews = sorted({task.crew_id for task in self.shift.tasks} - crew_ids)
        if unknown_crews:
            raise ValueError(f"tasks reference unknown crews: {', '.join(unknown_crews)}")
        if self.site.timezone != self.shift.timezone:
            raise ValueError("site and shift timezones must match")
        if self.site.timezone != "America/Phoenix":
            raise ValueError("custom scenarios must use the America/Phoenix reference timezone")
        shift_start_minute = self.shift.shift_start.hour * 60 + self.shift.shift_start.minute
        shift_end_minute = self.shift.shift_end.hour * 60 + self.shift.shift_end.minute
        if shift_start_minute < 6 * 60 or shift_end_minute > 16 * 60:
            raise ValueError("custom scenarios must stay inside the 06:00–16:00 reference window")

        ring = self.site.polygon["features"][0]["geometry"]["coordinates"][0]
        minimum_longitude = min(point[0] for point in ring)
        maximum_longitude = max(point[0] for point in ring)
        minimum_latitude = min(point[1] for point in ring)
        maximum_latitude = max(point[1] for point in ring)
        points = [self.site.cooling_zone_coordinates, *(task.location for task in self.shift.tasks)]
        if any(
            not (
                minimum_longitude <= point.longitude <= maximum_longitude
                and minimum_latitude <= point.latitude <= maximum_latitude
            )
            for point in points
        ):
            raise ValueError("task and cooling coordinates must remain inside the reference footprint")
        return self
