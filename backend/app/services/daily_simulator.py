from __future__ import annotations

import json
import math
import random
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from ..clients.llm import LLMUnavailable, ResponsesClient
from ..models.crew import AcclimatizationStatus, PPELevel
from ..models.daily import (
    DailyCrew,
    DailyEvidence,
    DailyJob,
    DailySite,
    HeatCell,
    HourlyCondition,
    SimulationRequest,
    SimulationSummary,
)
from ..models.site import GeoPoint
from ..models.task import Workload


FALLBACK_ACTIVITIES = [
    "Inbound load inspection",
    "Material transfer",
    "Equipment service",
    "Surface repair",
    "Electrical isolation",
    "Inventory movement",
    "Perimeter inspection",
    "Drainage clearance",
    "Container staging",
    "Safety barrier reset",
    "Utility trench check",
    "Outbound load securement",
]


def _extract_text(response: dict) -> str:
    if isinstance(response.get("output_text"), str):
        return response["output_text"].strip()
    parts: list[str] = []
    for item in response.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                parts.append(str(content["text"]))
    return "\n".join(parts).strip()


async def _activity_labels(site: DailySite) -> tuple[list[str], str]:
    client = ResponsesClient()
    if not client.available:
        return FALLBACK_ACTIVITIES, "deterministic_stochastic"
    try:
        response = await client.create(
            [{
                "role": "user",
                "content": json.dumps({"site_type": site.site_type, "count": 12}),
            }],
            [],
            (
                "Return only a JSON array of 12 short, realistic outdoor work activity names for the supplied "
                "site type. Each name must be 2-5 words, operational rather than dramatic, and contain no numbers."
            ),
        )
        text = _extract_text(response).removeprefix("```json").removesuffix("```").strip()
        values = json.loads(text)
        if (
            isinstance(values, list)
            and len(values) == 12
            and all(isinstance(value, str) and 2 <= len(value.split()) <= 5 and len(value) <= 60 for value in values)
        ):
            return values, "ai_enriched_stochastic"
    except (LLMUnavailable, ValueError, TypeError, json.JSONDecodeError):
        pass
    return FALLBACK_ACTIVITIES, "deterministic_stochastic"


def simulated_evidence(site: DailySite, seed: int) -> DailyEvidence:
    """Create a transparent local weather field for custom-site development runs."""
    rng = random.Random(seed ^ int(abs(site.centroid.longitude * 10_000)))
    date = site.operation_date
    zone = ZoneInfo(site.timezone)
    day_of_year = date.timetuple().tm_yday
    seasonal = math.cos(2 * math.pi * (day_of_year - 205) / 365)
    regional_boost = 4.5 if site.state_code in {"AZ", "NV", "TX", "FL", "NM", "CA"} else 2.0
    peak = 28.0 + 7.0 * seasonal + regional_boost + max(0.0, 34 - site.centroid.latitude) * .22
    peak = max(24.0, min(46.0, peak + rng.uniform(-1.2, 1.2)))
    humid_region = site.state_code in {"AL", "AR", "FL", "GA", "LA", "MS", "SC", "TX"}
    conditions: list[HourlyCondition] = []
    for hour in range(24):
        temperature = peak - .105 * (hour - 15) ** 2
        humidity = 72 - max(0, temperature - 23) * (1.25 if humid_region else 2.3)
        humidity += 12 if humid_region else 0
        humidity = max(16.0, min(92.0, humidity))
        apparent = temperature + max(0.0, humidity - 45) * .065 + (1.1 if 10 <= hour <= 16 else 0)
        solar = max(0.0, 820 * math.sin(math.pi * (hour - 6) / 13)) if 6 <= hour <= 19 else 0.0
        wet_bulb = temperature - max(1.2, (100 - humidity) / 8.2)
        conditions.append(HourlyCondition(
            timestamp=datetime.combine(date, time(hour), tzinfo=zone),
            temperature_c=round(temperature, 1),
            apparent_temperature_c=round(apparent, 1),
            wet_bulb_temperature_c=round(wet_bulb, 1),
            relative_humidity_percent=round(humidity, 1),
            solar_irradiance_ghi_wm2=round(solar),
            source="simulated",
        ))
    cells: list[HeatCell] = []
    latitude_scale = 111_320.0
    longitude_scale = latitude_scale * math.cos(math.radians(site.centroid.latitude))
    cell_size_m = 100
    for row in range(-3, 4):
        for column in range(-4, 5):
            west = site.centroid.longitude + column * cell_size_m / longitude_scale
            south = site.centroid.latitude + row * cell_size_m / latitude_scale
            east = west + cell_size_m / longitude_scale
            north = south + cell_size_m / latitude_scale
            offset = rng.uniform(-1.4, 1.6) + .18 * column - .08 * row
            cells.append(HeatCell(
                cell_id=f"sim-{row + 3}-{column + 4}",
                geometry={"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]},
                temperature_c_1500=round(peak + offset, 2),
                apparent_temperature_c=round(conditions[15].apparent_temperature_c + offset, 2),
                source="simulated",
            ))
    return DailyEvidence(
        date=date,
        conditions=conditions,
        heat_cells=cells,
        satellite_context={
            "vegetation_percent": round(rng.uniform(8, 34), 1),
            "pavement_percent": round(rng.uniform(42, 72), 1),
            "building_percent": round(rng.uniform(9, 28), 1),
        },
    )


class DailySimulator:
    async def generate(
        self,
        site: DailySite,
        request: SimulationRequest,
        *,
        use_ai: bool = True,
    ) -> tuple[list[DailyCrew], list[DailyJob], SimulationSummary]:
        labels, generation_mode = await _activity_labels(site) if use_ai else (FALLBACK_ACTIVITIES, "deterministic_stochastic")
        rng = random.Random(request.seed)
        crews = self._crews(site, request, rng)
        jobs = self._jobs(site, request, crews, labels, rng)
        summary = SimulationSummary(
            seed=request.seed,
            generation_mode=generation_mode,
            crew_count=len(crews),
            job_count=len(jobs),
            worker_count=sum(crew.worker_count for crew in crews),
            fixed_job_count=sum(not job.movable for job in jobs),
            movable_job_count=sum(job.movable for job in jobs),
        )
        return crews, jobs, summary

    @staticmethod
    def _crews(site: DailySite, request: SimulationRequest, rng: random.Random) -> list[DailyCrew]:
        roles = ["Civil", "Materials", "Mechanical", "Electrical", "Inspection", "Logistics", "Utility", "Response", "Surface", "Support", "Field", "Mobile"]
        crews: list[DailyCrew] = []
        for index in range(request.crew_count):
            crews.append(DailyCrew(
                crew_id=f"{site.site_id}-crew-{index + 1}",
                site_id=site.site_id,
                name=f"{roles[index]} crew",
                worker_count=rng.randint(7, 14),
                acclimatization_status=rng.choices(
                    [AcclimatizationStatus.ACCLIMATIZED, AcclimatizationStatus.RETURNING, AcclimatizationStatus.NEW],
                    weights=[.62, .25, .13],
                )[0],
                ppe_level=rng.choices([PPELevel.LOW, PPELevel.MEDIUM, PPELevel.HIGH], weights=[.25, .55, .2])[0],
                default_workload=rng.choices([Workload.MODERATE, Workload.HEAVY, Workload.VERY_HEAVY], weights=[.34, .5, .16])[0],
            ))
        return crews

    @staticmethod
    def _jobs(
        site: DailySite,
        request: SimulationRequest,
        crews: list[DailyCrew],
        labels: list[str],
        rng: random.Random,
    ) -> list[DailyJob]:
        zone = ZoneInfo(site.timezone)
        slots = [7, 9, 11, 13, 15, 17]
        workloads = [Workload.LIGHT, Workload.MODERATE, Workload.HEAVY, Workload.VERY_HEAVY]
        jobs: list[DailyJob] = []
        latitude_scale = 111_320.0
        longitude_scale = latitude_scale * math.cos(math.radians(site.centroid.latitude))
        for crew_index, crew in enumerate(crews):
            for sequence in range(request.jobs_per_crew):
                job_index = crew_index * request.jobs_per_crew + sequence
                start_hour = slots[sequence]
                duration = rng.choice([60, 60, 90])
                original = datetime.combine(site.operation_date, time(start_hour), tzinfo=zone)
                movable = rng.random() >= .24
                label = labels[job_index % len(labels)]
                zone_label = chr(65 + job_index % 8)
                eligible = [crew.crew_id]
                if movable and rng.random() < .48:
                    eligible.append(crews[(crew_index + 1) % len(crews)].crew_id)
                dx = rng.uniform(-340, 340)
                dy = rng.uniform(-270, 270)
                jobs.append(DailyJob(
                    job_id=f"{site.site_id}-job-{job_index + 1}",
                    site_id=site.site_id,
                    name=f"{label} · Zone {zone_label}",
                    location=GeoPoint(
                        longitude=site.centroid.longitude + dx / longitude_scale,
                        latitude=site.centroid.latitude + dy / latitude_scale,
                    ),
                    duration_minutes=duration,
                    workload=rng.choices(workloads, weights=[.12, .34, .39, .15])[0],
                    original_start=original,
                    earliest_start=datetime.combine(site.operation_date, time(6), tzinfo=zone) if movable else original,
                    latest_finish=datetime.combine(site.operation_date, time(20), tzinfo=zone) if movable else original + timedelta(minutes=duration),
                    assigned_crew_id=crew.crew_id,
                    eligible_crew_ids=eligible,
                    movable=movable,
                    shaded=rng.random() < .28,
                ))
        return jobs


daily_simulator = DailySimulator()

