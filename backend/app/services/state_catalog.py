from __future__ import annotations

import math
from typing import Any

from ..models.weekly import GeometryInput
from .state_boundaries import point_in_state


# Bounding boxes provide a fast rejection pass; every accepted vertex is then
# checked against the decoded US state TopoJSON boundary in state_boundaries.py.
STATE_CATALOG: dict[str, dict[str, Any]] = {
    "AL": {"name": "Alabama", "bbox": [-88.48, 30.14, -84.89, 35.01]},
    "AK": {"name": "Alaska", "bbox": [-179.15, 51.21, -129.98, 71.44]},
    "AZ": {"name": "Arizona", "bbox": [-114.82, 31.33, -109.04, 37.01]},
    "AR": {"name": "Arkansas", "bbox": [-94.62, 33.00, -89.64, 36.50]},
    "CA": {"name": "California", "bbox": [-124.48, 32.53, -114.13, 42.01]},
    "CO": {"name": "Colorado", "bbox": [-109.06, 36.99, -102.04, 41.00]},
    "CT": {"name": "Connecticut", "bbox": [-73.73, 40.98, -71.79, 42.05]},
    "DE": {"name": "Delaware", "bbox": [-75.79, 38.45, -75.05, 39.84]},
    "DC": {"name": "Washington, DC", "bbox": [-77.12, 38.79, -76.91, 39.00]},
    "FL": {"name": "Florida", "bbox": [-87.64, 24.40, -80.03, 31.00]},
    "GA": {"name": "Georgia", "bbox": [-85.61, 30.36, -80.84, 35.00]},
    "HI": {"name": "Hawaii", "bbox": [-160.25, 18.91, -154.80, 22.24]},
    "ID": {"name": "Idaho", "bbox": [-117.24, 41.99, -111.04, 49.00]},
    "IL": {"name": "Illinois", "bbox": [-91.51, 36.97, -87.49, 42.51]},
    "IN": {"name": "Indiana", "bbox": [-88.10, 37.77, -84.78, 41.76]},
    "IA": {"name": "Iowa", "bbox": [-96.64, 40.37, -90.14, 43.50]},
    "KS": {"name": "Kansas", "bbox": [-102.05, 36.99, -94.59, 40.00]},
    "KY": {"name": "Kentucky", "bbox": [-89.57, 36.50, -81.96, 39.15]},
    "LA": {"name": "Louisiana", "bbox": [-94.04, 28.85, -88.82, 33.02]},
    "ME": {"name": "Maine", "bbox": [-71.09, 42.97, -66.95, 47.46]},
    "MD": {"name": "Maryland", "bbox": [-79.49, 37.89, -75.05, 39.72]},
    "MA": {"name": "Massachusetts", "bbox": [-73.51, 41.24, -69.93, 42.89]},
    "MI": {"name": "Michigan", "bbox": [-90.42, 41.70, -82.12, 48.31]},
    "MN": {"name": "Minnesota", "bbox": [-97.24, 43.50, -89.49, 49.38]},
    "MS": {"name": "Mississippi", "bbox": [-91.66, 30.17, -88.10, 35.00]},
    "MO": {"name": "Missouri", "bbox": [-95.77, 35.99, -89.10, 40.61]},
    "MT": {"name": "Montana", "bbox": [-116.05, 44.36, -104.04, 49.00]},
    "NE": {"name": "Nebraska", "bbox": [-104.06, 39.99, -95.31, 43.00]},
    "NV": {"name": "Nevada", "bbox": [-120.01, 35.00, -114.04, 42.00]},
    "NH": {"name": "New Hampshire", "bbox": [-72.56, 42.70, -70.61, 45.31]},
    "NJ": {"name": "New Jersey", "bbox": [-75.56, 38.93, -73.89, 41.36]},
    "NM": {"name": "New Mexico", "bbox": [-109.05, 31.33, -103.00, 37.00]},
    "NY": {"name": "New York", "bbox": [-79.76, 40.49, -71.86, 45.02]},
    "NC": {"name": "North Carolina", "bbox": [-84.32, 33.84, -75.46, 36.59]},
    "ND": {"name": "North Dakota", "bbox": [-104.05, 45.94, -96.55, 49.00]},
    "OH": {"name": "Ohio", "bbox": [-84.82, 38.40, -80.52, 42.33]},
    "OK": {"name": "Oklahoma", "bbox": [-103.00, 33.62, -94.43, 37.00]},
    "OR": {"name": "Oregon", "bbox": [-124.57, 41.99, -116.46, 46.30]},
    "PA": {"name": "Pennsylvania", "bbox": [-80.52, 39.72, -74.69, 42.27]},
    "RI": {"name": "Rhode Island", "bbox": [-71.86, 41.15, -71.12, 42.02]},
    "SC": {"name": "South Carolina", "bbox": [-83.36, 32.03, -78.54, 35.22]},
    "SD": {"name": "South Dakota", "bbox": [-104.06, 42.48, -96.44, 45.95]},
    "TN": {"name": "Tennessee", "bbox": [-90.31, 34.98, -81.65, 36.68]},
    "TX": {"name": "Texas", "bbox": [-106.65, 25.84, -93.51, 36.50]},
    "UT": {"name": "Utah", "bbox": [-114.05, 36.99, -109.04, 42.00]},
    "VT": {"name": "Vermont", "bbox": [-73.44, 42.73, -71.46, 45.02]},
    "VA": {"name": "Virginia", "bbox": [-83.68, 36.54, -75.24, 39.47]},
    "WA": {"name": "Washington", "bbox": [-124.85, 45.54, -116.92, 49.00]},
    "WV": {"name": "West Virginia", "bbox": [-82.64, 37.20, -77.72, 40.64]},
    "WI": {"name": "Wisconsin", "bbox": [-92.89, 42.49, -86.25, 47.31]},
    "WY": {"name": "Wyoming", "bbox": [-111.06, 40.99, -104.05, 45.01]},
}


def circle_feature_collection(longitude: float, latitude: float, radius_m: float) -> dict:
    coordinates: list[list[float]] = []
    latitude_scale = 111_320.0
    longitude_scale = latitude_scale * math.cos(math.radians(latitude))
    for index in range(32):
        angle = 2 * math.pi * index / 32
        coordinates.append(
            [
                longitude + math.cos(angle) * radius_m / longitude_scale,
                latitude + math.sin(angle) * radius_m / latitude_scale,
            ]
        )
    coordinates.append(coordinates[0])
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {},
            "geometry": {"type": "Polygon", "coordinates": [coordinates]},
        }],
    }


def normalize_geometry(value: GeometryInput) -> dict:
    if value.type == "polygon":
        assert value.polygon is not None
        polygon = value.polygon
    else:
        assert value.longitude is not None and value.latitude is not None and value.radius_m is not None
        polygon = circle_feature_collection(value.longitude, value.latitude, value.radius_m)
    features = polygon.get("features", [])
    if polygon.get("type") != "FeatureCollection" or len(features) != 1:
        raise ValueError("geometry must be a GeoJSON FeatureCollection with exactly one Polygon")
    geometry = features[0].get("geometry", {})
    coordinates = geometry.get("coordinates", [])
    if geometry.get("type") != "Polygon" or len(coordinates) != 1:
        raise ValueError("site geometry must be one Polygon without holes")
    ring = coordinates[0]
    if len(ring) < 4 or len(ring) > 501 or ring[0] != ring[-1]:
        raise ValueError("site geometry must be a closed Polygon")
    if any(not isinstance(point, list) or len(point) != 2 or not all(isinstance(item, (int, float)) for item in point) for point in ring):
        raise ValueError("polygon vertices must be longitude/latitude number pairs")
    if any(not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90) for point in ring):
        raise ValueError("polygon vertices contain invalid coordinates")
    if _has_self_intersection(ring):
        raise ValueError("site polygon must not self-intersect")
    return polygon


def _has_self_intersection(ring: list[list[float]]) -> bool:
    def orientation(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    segments = list(zip(ring, ring[1:], strict=False))
    for left_index, (a, b) in enumerate(segments):
        for right_index, (c, d) in enumerate(segments):
            if right_index <= left_index + 1 or (left_index == 0 and right_index == len(segments) - 1):
                continue
            if orientation(a, b, c) * orientation(a, b, d) < 0 and orientation(c, d, a) * orientation(c, d, b) < 0:
                return True
    return False


def polygon_centroid(polygon: dict) -> tuple[float, float]:
    ring = polygon["features"][0]["geometry"]["coordinates"][0][:-1]
    return sum(point[0] for point in ring) / len(ring), sum(point[1] for point in ring) / len(ring)


def polygon_area_square_miles(polygon: dict) -> float:
    ring = polygon["features"][0]["geometry"]["coordinates"][0]
    latitude = sum(point[1] for point in ring) / len(ring)
    x_scale = 111_320.0 * math.cos(math.radians(latitude))
    y_scale = 111_320.0
    area_twice = 0.0
    for left, right in zip(ring, ring[1:], strict=False):
        area_twice += left[0] * x_scale * right[1] * y_scale
        area_twice -= right[0] * x_scale * left[1] * y_scale
    return abs(area_twice) / 2 / 2_589_988.11


def validate_in_state(polygon: dict, state_code: str) -> None:
    state = STATE_CATALOG.get(state_code.upper())
    if state is None:
        raise ValueError("unsupported state code")
    area = polygon_area_square_miles(polygon)
    if area <= 0.000001:
        raise ValueError("site polygon must have a positive area")
    if area > 10:
        raise ValueError("site area must not exceed 10 mi²")
    west, south, east, north = state["bbox"]
    ring = polygon["features"][0]["geometry"]["coordinates"][0]
    if any(not (west <= longitude <= east and south <= latitude <= north) for longitude, latitude in ring):
        raise ValueError("geometry must remain inside the selected state")
    for left, right in zip(ring, ring[1:], strict=False):
        steps = min(1000, max(1, math.ceil(max(abs(right[0] - left[0]), abs(right[1] - left[1])) / 0.002)))
        for step in range(steps + 1):
            longitude = left[0] + (right[0] - left[0]) * step / steps
            latitude = left[1] + (right[1] - left[1]) * step / steps
            if not point_in_state(longitude, latitude, state_code):
                raise ValueError("geometry must remain inside the selected state boundary")


def state_options() -> list[dict[str, str]]:
    return [
        {"code": code, "name": details["name"]}
        for code, details in sorted(STATE_CATALOG.items(), key=lambda item: item[1]["name"])
    ]
