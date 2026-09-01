from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from ..config import ROOT_DIR


STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "DC": "11",
    "FL": "12", "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30",
    "NE": "31", "NV": "32", "NH": "33", "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49",
    "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55", "WY": "56",
}


@lru_cache(maxsize=1)
def _topology() -> tuple[dict[str, Any], list[list[list[float]]]]:
    payload = json.loads((ROOT_DIR / "data" / "geo" / "us-states-10m.json").read_text())
    scale_x, scale_y = payload["transform"]["scale"]
    translate_x, translate_y = payload["transform"]["translate"]
    decoded = []
    for arc in payload["arcs"]:
        x = y = 0
        points = []
        for delta_x, delta_y in arc:
            x += delta_x
            y += delta_y
            points.append([x * scale_x + translate_x, y * scale_y + translate_y])
        decoded.append(points)
    return payload, decoded


def _ring(arc_ids: list[int], arcs: list[list[list[float]]]) -> list[list[float]]:
    points: list[list[float]] = []
    for arc_id in arc_ids:
        values = arcs[arc_id] if arc_id >= 0 else list(reversed(arcs[~arc_id]))
        points.extend(values if not points else values[1:])
    if points and points[0] != points[-1]:
        points.append(points[0])
    return points


@lru_cache(maxsize=51)
def state_multipolygon(state_code: str) -> list[list[list[list[float]]]]:
    payload, arcs = _topology()
    fips = STATE_FIPS[state_code.upper()]
    geometry = next(item for item in payload["objects"]["states"]["geometries"] if str(item["id"]).zfill(2) == fips)
    polygon_arcs = [geometry["arcs"]] if geometry["type"] == "Polygon" else geometry["arcs"]
    return [[_ring(ring, arcs) for ring in polygon] for polygon in polygon_arcs]


def _on_segment(point: list[float], left: list[float], right: list[float], tolerance: float = 1e-9) -> bool:
    cross = (point[1] - left[1]) * (right[0] - left[0]) - (point[0] - left[0]) * (right[1] - left[1])
    return abs(cross) <= tolerance and min(left[0], right[0]) - tolerance <= point[0] <= max(left[0], right[0]) + tolerance and min(left[1], right[1]) - tolerance <= point[1] <= max(left[1], right[1]) + tolerance


def _inside_ring(point: list[float], ring: list[list[float]]) -> bool:
    inside = False
    for left, right in zip(ring, ring[1:], strict=False):
        if _on_segment(point, left, right):
            return True
        if (left[1] > point[1]) != (right[1] > point[1]):
            intersection = (right[0] - left[0]) * (point[1] - left[1]) / (right[1] - left[1]) + left[0]
            if point[0] < intersection:
                inside = not inside
    return inside


def point_in_state(longitude: float, latitude: float, state_code: str) -> bool:
    point = [longitude, latitude]
    for polygon in state_multipolygon(state_code):
        if not polygon or not _inside_ring(point, polygon[0]):
            continue
        if not any(_inside_ring(point, hole) for hole in polygon[1:]):
            return True
    return False


def point_in_feature_collection(longitude: float, latitude: float, collection: dict[str, Any]) -> bool:
    point = [longitude, latitude]
    for feature in collection.get("features", []):
        geometry = feature.get("geometry", {})
        coordinates = geometry.get("coordinates", [])
        polygons = [coordinates] if geometry.get("type") == "Polygon" else coordinates if geometry.get("type") == "MultiPolygon" else []
        for polygon in polygons:
            if polygon and _inside_ring(point, polygon[0]) and not any(_inside_ring(point, hole) for hole in polygon[1:]):
                return True
    return False
