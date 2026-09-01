from __future__ import annotations

import hashlib
import json
import math
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from ..config import ROOT_DIR
from ..models.crew import AcclimatizationStatus, PPELevel
from ..models.site import GeoPoint
from ..models.task import Workload
from ..models.weekly import (
    DEFAULT_WEEK_START,
    DataStatus,
    HeatCell,
    HourlyCondition,
    JobStatus,
    SiteDay,
    WeeklyCrew,
    WeeklyJob,
    WeeklySite,
)
from .state_catalog import circle_feature_collection


CURATED_SITES = [
    {
        "site_id": "desertline-phoenix",
        "name": "DesertLine Logistics Yard",
        "state_code": "AZ",
        "site_type": "Logistics yard",
        "longitude": -112.0675,
        "latitude": 33.4515,
        "timezone": "America/Phoenix",
        "temperature_peak": 43.2,
    },
    {
        "site_id": "gulfgate-houston",
        "name": "GulfGate Container Terminal",
        "state_code": "TX",
        "site_type": "Container terminal",
        "longitude": -95.2580,
        "latitude": 29.7420,
        "timezone": "America/Chicago",
        "temperature_peak": 37.2,
    },
    {
        "site_id": "sungrid-miami",
        "name": "SunGrid Utility Response Zone",
        "state_code": "FL",
        "site_type": "Utility response zone",
        "longitude": -80.2150,
        "latitude": 25.7800,
        "timezone": "America/New_York",
        "temperature_peak": 34.8,
    },
    {
        "site_id": "silverroad-las-vegas",
        "name": "SilverRoad Highway Maintenance",
        "state_code": "NV",
        "site_type": "Highway maintenance zone",
        "longitude": -115.1720,
        "latitude": 36.1510,
        "timezone": "America/Los_Angeles",
        "temperature_peak": 44.5,
    },
    {
        "site_id": "metroworks-new-york",
        "name": "MetroWorks Infrastructure Hub",
        "state_code": "NY",
        "site_type": "Infrastructure works hub",
        "longitude": -73.9860,
        "latitude": 40.7520,
        "timezone": "America/New_York",
        "temperature_peak": 33.4,
    },
]


def _load_cached_week(site_id: str) -> tuple[list[SiteDay] | None, str | None]:
    path = ROOT_DIR / "data" / "curated" / site_id / "week-2024-07-15.json"
    if not path.exists():
        return None, None
    raw = path.read_bytes()
    payload = json.loads(raw)
    return [SiteDay.model_validate(day) for day in payload["days"]], hashlib.sha256(raw).hexdigest()


def _demonstration_days(config: dict) -> list[SiteDay]:
    """A labeled development fallback; never presented as provider evidence."""
    zone = ZoneInfo(config["timezone"])
    days: list[SiteDay] = []
    for day_index in range(7):
        current_date = DEFAULT_WEEK_START + timedelta(days=day_index)
        daily_peak = config["temperature_peak"] + math.sin(day_index * 0.9) * 1.1
        conditions: list[HourlyCondition] = []
        for hour in range(24):
            temperature = daily_peak - 0.115 * (hour - 15) ** 2
            humidity = max(15.0, min(88.0, 64 - (temperature - 25) * 2 + (12 if config["state_code"] in {"TX", "FL", "NY"} else 0)))
            apparent = temperature + max(0, humidity - 45) * 0.055 + (1.2 if 10 <= hour <= 16 else 0)
            solar = max(0.0, 780 * math.sin(math.pi * (hour - 6) / 13)) if 6 <= hour <= 19 else 0.0
            wet_bulb = temperature - max(1.5, (100 - humidity) / 7.8)
            conditions.append(HourlyCondition(
                timestamp=datetime.combine(current_date, time(hour), tzinfo=zone),
                temperature_c=round(temperature, 1),
                apparent_temperature_c=round(apparent, 1),
                wet_bulb_temperature_c=round(wet_bulb, 1),
                relative_humidity_percent=round(humidity, 1),
                solar_irradiance_ghi_wm2=round(solar, 0),
                source="demonstration",
            ))
        cells: list[HeatCell] = []
        for row in range(6):
            for column in range(8):
                lon = config["longitude"] + (column - 4) * 0.0014
                lat = config["latitude"] + (row - 3) * 0.0012
                offset = math.sin(row * 1.3 + column * 0.7) * 1.1
                geometry = {
                    "type": "Polygon",
                    "coordinates": [[
                        [lon, lat], [lon + .0013, lat], [lon + .0013, lat + .0011],
                        [lon, lat + .0011], [lon, lat],
                    ]],
                }
                cells.append(HeatCell(
                    cell_id=f"{current_date}-{row}-{column}",
                    geometry=geometry,
                    temperature_c_1500=round(daily_peak + offset, 2),
                    apparent_temperature_c=round(conditions[15].apparent_temperature_c + offset, 2),
                    source="demonstration",
                ))
        days.append(SiteDay(
            date=current_date,
            conditions=conditions,
            heat_cells=cells,
            satellite_context={"vegetation_percent": 12 + day_index % 3, "pavement_percent": 61, "building_percent": 19},
        ))
    return days


def _site(config: dict) -> tuple[WeeklySite, list[SiteDay]]:
    geometry = circle_feature_collection(config["longitude"], config["latitude"], 600)
    cached, integrity = _load_cached_week(config["site_id"])
    has_evidence = cached is not None
    days = cached or _demonstration_days(config)
    thermal = round(sum(max(0, item.apparent_temperature_c - 35) for day in days for item in day.conditions), 1)
    site = WeeklySite(
        site_id=config["site_id"],
        name=config["name"],
        state_code=config["state_code"],
        site_type=config["site_type"],
        geometry=geometry,
        centroid=GeoPoint(longitude=config["longitude"], latitude=config["latitude"]),
        timezone=config["timezone"],
        curated=True,
        data_status=DataStatus.READY if has_evidence else DataStatus.DEGRADED,
        evidence_week_start=DEFAULT_WEEK_START,
        source_label=(
            f"Cached FortyGuard site-week · SHA-256 {integrity[:12]}…"
            if integrity
            else "Labeled demonstration profile · real site-week cache not seeded"
        ),
        thermal_burden=thermal,
    )
    return site, days


def _crews(site_id: str, index: int) -> list[WeeklyCrew]:
    names = [
        ("North crew", 4, AcclimatizationStatus.ACCLIMATIZED, PPELevel.MEDIUM, Workload.HEAVY),
        ("Mobile crew", 3, AcclimatizationStatus.RETURNING, PPELevel.LOW, Workload.MODERATE),
        ("Specialist crew", 2, AcclimatizationStatus.NEW if index % 2 else AcclimatizationStatus.ACCLIMATIZED, PPELevel.HIGH, Workload.HEAVY),
    ]
    return [WeeklyCrew(
        crew_id=f"{site_id}-crew-{number + 1}", site_id=site_id, name=name,
        worker_count=count, acclimatization_status=acclimatization, ppe_level=ppe,
        default_workload=workload,
    ) for number, (name, count, acclimatization, ppe, workload) in enumerate(names)]


def _jobs(site: WeeklySite, crews: list[WeeklyCrew], index: int) -> list[WeeklyJob]:
    zone = ZoneInfo(site.timezone)
    templates = [
        ("Equipment inspection", 0, 13, 90, Workload.MODERATE, True, False, 0, []),
        ("Material handling", 1, 12, 180, Workload.HEAVY, True, False, 1, []),
        ("Electrical isolation", 2, 9, 120, Workload.MODERATE, False, True, 2, []),
        ("Surface repair", 3, 14, 150, Workload.VERY_HEAVY, True, False, 0, [0]),
        ("Inventory and closeout", 4, 11, 120, Workload.LIGHT, True, True, 1, []),
        ("Perimeter inspection", 5, 15, 90, Workload.MODERATE, True, False, 2, []),
    ]
    jobs: list[WeeklyJob] = []
    for number, (name, day_offset, hour, duration, workload, movable, shaded, crew_index, dependencies) in enumerate(templates):
        start_date = DEFAULT_WEEK_START + timedelta(days=day_offset)
        original = datetime.combine(start_date, time(hour), tzinfo=zone)
        earliest_date = start_date - timedelta(days=1) if number == 3 else start_date
        latest_date = start_date + timedelta(days=1) if number in {1, 3, 5} else start_date
        earliest = datetime.combine(max(DEFAULT_WEEK_START, earliest_date), time(6), tzinfo=zone)
        latest = datetime.combine(min(DEFAULT_WEEK_START + timedelta(days=6), latest_date), time(18), tzinfo=zone)
        assigned = crews[crew_index]
        eligible = [assigned.crew_id]
        if movable and number in {1, 4, 5}:
            eligible.append(crews[(crew_index + 1) % len(crews)].crew_id)
        jobs.append(WeeklyJob(
            job_id=f"{site.site_id}-job-{number + 1}",
            site_id=site.site_id,
            name=name if index == 0 else f"{name} · {site.site_type.split()[0]}",
            location=GeoPoint(
                longitude=site.centroid.longitude + (number % 3 - 1) * .0022,
                latitude=site.centroid.latitude + (number // 3 - .5) * .0022,
            ),
            duration_minutes=duration,
            workload=workload,
            original_start=original,
            earliest_start=earliest,
            latest_finish=latest,
            assigned_crew_id=assigned.crew_id,
            eligible_crew_ids=eligible,
            dependencies=[f"{site.site_id}-job-{dependency + 1}" for dependency in dependencies],
            movable=movable,
            shaded=shaded,
            status=JobStatus.PENDING,
        ))
    return jobs


def build_curated_portfolio() -> dict[str, tuple[WeeklySite, list[WeeklyCrew], list[WeeklyJob], list[SiteDay]]]:
    portfolio = {}
    for index, config in enumerate(CURATED_SITES):
        site, days = _site(config)
        crews = _crews(site.site_id, index)
        portfolio[site.site_id] = (site, crews, _jobs(site, crews, index), days)
    return portfolio
