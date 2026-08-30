from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class EnvironmentalObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp: datetime
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    apparent_temperature_c: float | None = None
    heat_index_c: float | None = None
    wet_bulb_temperature_c: float | None = None
    relative_humidity_percent: float | None = None
    solar_irradiance_ghi_wm2: float | None = None
    source: str
    activity_id: str


class DataProvenance(BaseModel):
    source_label: str
    captured_at: datetime
    heatmap_activity_id: str
    environmental_activity_id: str
    heatmap_timestamp: str
    environmental_time_range: str
    mode: str


class HeatDataBundle(BaseModel):
    heatmap_geojson: dict
    temperature_stats: dict[str, float]
    observations: list[EnvironmentalObservation]
    provenance: DataProvenance

