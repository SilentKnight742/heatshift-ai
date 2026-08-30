from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GeoPoint(BaseModel):
    longitude: float = Field(ge=-180, le=180)
    latitude: float = Field(ge=-90, le=90)


class Site(BaseModel):
    model_config = ConfigDict(extra="forbid")

    site_id: str
    name: str
    polygon: dict
    timezone: str
    surface_type: str = "paved industrial yard"
    shade_available: bool = True
    cooling_zone_coordinates: GeoPoint
    fictional: bool = True

    @field_validator("polygon")
    @classmethod
    def validate_polygon(cls, polygon: dict) -> dict:
        if polygon.get("type") != "FeatureCollection":
            raise ValueError("polygon must be a GeoJSON FeatureCollection")
        features = polygon.get("features", [])
        if not features:
            raise ValueError("polygon must include at least one feature")
        geometry = features[0].get("geometry", {})
        if geometry.get("type") != "Polygon":
            raise ValueError("site geometry must be a Polygon")
        ring = geometry.get("coordinates", [[]])[0]
        if len(ring) < 4 or ring[0] != ring[-1]:
            raise ValueError("polygon ring must be closed")
        for longitude, latitude in ring:
            GeoPoint(longitude=longitude, latitude=latitude)
        return polygon

