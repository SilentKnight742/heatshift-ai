from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from ..clients.fortyguard import FortyGuardClient, FortyGuardError
from ..config import settings
from ..models.weekly import DataStatus, HeatCell, HourlyCondition, ProvisionRequest, ProvisionStatus, SiteDay
from .turnstile import TurnstileError, turnstile_verifier
from .weekly_store import WorkspaceRecord, weekly_store


class ProvisioningError(RuntimeError):
    pass


class ProvisioningService:
    def __init__(self) -> None:
        self.client = FortyGuardClient()
        self._reservation_lock = asyncio.Lock()
        self._global_reserved = 0

    async def advance(
        self,
        owner_id: str,
        site_id: str,
        request: ProvisionRequest,
        remote_ip: str | None = None,
    ) -> ProvisionStatus:
        workspace = await weekly_store.workspace(owner_id)
        record = await weekly_store.site_record(owner_id, site_id)
        if request.idempotency_key in workspace.idempotency:
            existing_id = workspace.idempotency[request.idempotency_key]
            state = workspace.provisioning[existing_id]
            await self._advance_one(record, state)
            return _public(state)
        if workspace.state.live_site_week_used:
            raise ProvisioningError("This anonymous workspace has already used its one live site-week")
        if record.site.curated:
            raise ProvisioningError("Curated sites are immutable; create a private site to provision another week")
        if request.week_start < date(2019, 1, 1):
            raise ProvisioningError("Week must start on or after January 1, 2019")
        today_local = datetime.now(ZoneInfo(record.site.timezone)).date()
        if request.week_start + timedelta(days=6) >= today_local:
            raise ProvisioningError("Week must end before the current local day")
        try:
            await turnstile_verifier.verify(request.turnstile_token, remote_ip)
        except TurnstileError as exc:
            raise ProvisioningError(str(exc)) from exc
        if not self.client.configured:
            raise ProvisioningError("FortyGuard is not configured; use a curated site")
        usage = await self.client.get_credit_usage()
        remaining = _remaining_credits(usage)
        if remaining is None:
            raise ProvisioningError("FortyGuard usage could not be verified; no provider work was submitted")
        async with self._reservation_lock:
            after_reservation = remaining - self._global_reserved - settings.fortyguard_site_week_estimate
            if after_reservation < settings.fortyguard_credit_reserve:
                raise ProvisioningError("Insufficient unreserved credits; use a curated site")
            self._global_reserved += settings.fortyguard_site_week_estimate
        provisioning_id = str(uuid.uuid4())
        state = {
            "provisioning_id": provisioning_id,
            "site_id": site_id,
            "state": "reserved",
            "completed_stages": ["identity", "turnstile", "geometry", "quota", "credit_reservation"],
            "pending_stages": [f"heatmap:{request.week_start + timedelta(days=i)}" for i in range(7)]
                + [f"environment:{request.week_start + timedelta(days=i)}" for i in range(7)]
                + ["satellite", "normalize"],
            "reserved_credits": settings.fortyguard_site_week_estimate,
            "activity_ids": {},
            "error": None,
            "week_start": request.week_start,
            "days": {},
            "satellite": {},
        }
        workspace.provisioning[provisioning_id] = state
        workspace.idempotency[request.idempotency_key] = provisioning_id
        workspace.state.live_site_week_used = True
        workspace.state.live_site_weeks_remaining = 0
        record.site.data_status = DataStatus.PROVISIONING
        await self._advance_one(record, state)
        return _public(state)

    async def get(self, owner_id: str, site_id: str) -> ProvisionStatus:
        workspace = await weekly_store.workspace(owner_id)
        state = next((item for item in workspace.provisioning.values() if item["site_id"] == site_id), None)
        if state is None:
            raise KeyError("no provisioning job exists for this site")
        return _public(state)

    async def _advance_one(self, record, state: dict) -> None:
        if state["state"] in {"ready", "degraded", "failed"}:
            return
        try:
            week_start = state["week_start"]
            for offset in range(7):
                day = week_start + timedelta(days=offset)
                day_key = day.isoformat()
                item = state["days"].setdefault(day_key, {})
                if "heatmap_id" not in item:
                    item["heatmap_request"] = {
                        "polygon_aoi": record.site.geometry,
                        "date_time": {"start_date": day_key, "start_time": "15:00", "filter_type": 1},
                        "granularity": 100,
                    }
                    item["heatmap_id"] = await self.client.submit_heatmap(
                        record.site.geometry, item["heatmap_request"]["date_time"], 100
                    )
                    state["activity_ids"][f"heatmap:{day_key}"] = item["heatmap_id"]
                    state["state"] = "submitting"
                    return
                if "heatmap_result" not in item:
                    result = await self.client.get_activity_status(item["heatmap_id"])
                    status = str(result.get("data", {}).get("status", "")).lower()
                    if status in {"failed", "error"}:
                        raise ProvisioningError(f"Heatmap failed for {day_key}")
                    if status not in {"completed", "succeeded"}:
                        state["state"] = "polling"
                        return
                    features = result.get("data", {}).get("result", {}).get("map_data", {}).get("features", [])
                    if not features:
                        raise ProvisioningError(f"Heatmap completed without cells for {day_key}")
                    item["heatmap_result"] = result
                    _complete_stage(state, f"heatmap:{day_key}")
                    return
                if "environment_id" not in item:
                    stats = item["heatmap_result"]["data"]["result"]["stats_data"]["temperature_stats"]
                    item["environment_request"] = {
                        "latitude": record.site.centroid.latitude,
                        "longitude": record.site.centroid.longitude,
                        "temperature": stats["mean"],
                        "date_time": {"start_date": day_key, "start_time": "00:00", "end_time": "23:00", "filter_type": 2},
                    }
                    item["environment_id"] = await self.client.submit_environmental_parameters(**item["environment_request"])
                    state["activity_ids"][f"environment:{day_key}"] = item["environment_id"]
                    state["state"] = "submitting"
                    return
                if "environment_result" not in item:
                    result = await self.client.get_activity_status(item["environment_id"])
                    status = str(result.get("data", {}).get("status", "")).lower()
                    if status in {"failed", "error"}:
                        raise ProvisioningError(f"Environmental request failed for {day_key}")
                    if status not in {"completed", "succeeded"}:
                        state["state"] = "polling"
                        return
                    locations = result.get("data", {}).get("result", {}).get("locations", [])
                    if not locations:
                        raise ProvisioningError(f"Environmental request returned no observations for {day_key}")
                    item["environment_result"] = result
                    _complete_stage(state, f"environment:{day_key}")
                    return
            satellite = state["satellite"]
            if "activity_id" not in satellite:
                satellite["activity_id"] = await self.client.submit_satellite_segmentation(
                    record.site.centroid.latitude,
                    record.site.centroid.longitude,
                    {"start_date": week_start.isoformat(), "start_time": "15:00", "filter_type": 1},
                    100,
                )
                state["activity_ids"]["satellite"] = satellite["activity_id"]
                state["state"] = "submitting"
                return
            if "result" not in satellite:
                result = await self.client.get_activity_status(satellite["activity_id"])
                status = str(result.get("data", {}).get("status", "")).lower()
                if status in {"failed", "error"}:
                    state["error"] = "Satellite context failed; environmental site-week remains usable"
                    satellite["result"] = {}
                    _complete_stage(state, "satellite")
                elif status not in {"completed", "succeeded"}:
                    state["state"] = "polling"
                    return
                else:
                    satellite["result"] = result
                    _complete_stage(state, "satellite")
                    return
            record.days = _normalize_days(record, state)
            record.site.evidence_week_start = week_start
            record.site.data_status = DataStatus.DEGRADED if state["error"] else DataStatus.READY
            record.site.source_label = "Live FortyGuard site-week; HeatShift hourly spatial interpolation disclosed"
            record.analysis = None
            _complete_stage(state, "normalize")
            state["state"] = "degraded" if state["error"] else "ready"
            async with self._reservation_lock:
                self._global_reserved = max(0, self._global_reserved - state["reserved_credits"])
        except (FortyGuardError, ProvisioningError, KeyError, TypeError, ValueError) as exc:
            state["state"] = "failed"
            state["error"] = str(exc)
            record.site.data_status = DataStatus.FAILED
            async with self._reservation_lock:
                self._global_reserved = max(0, self._global_reserved - state["reserved_credits"])


def _remaining_credits(payload: Any) -> int | None:
    if isinstance(payload, dict):
        for key in ("remaining_credits", "credits_remaining", "available_credits", "credit_balance", "balance"):
            value = payload.get(key)
            if isinstance(value, (int, float)):
                return int(value)
        total = next((payload.get(key) for key in ("total_credits", "credits_allocated", "credit_limit") if isinstance(payload.get(key), (int, float))), None)
        used = next((payload.get(key) for key in ("credits_used", "used_credits", "total_credits_used") if isinstance(payload.get(key), (int, float))), None)
        if total is not None and used is not None:
            return int(total - used)
        for value in payload.values():
            found = _remaining_credits(value)
            if found is not None:
                return found
    if isinstance(payload, list):
        for value in payload:
            found = _remaining_credits(value)
            if found is not None:
                return found
    return None


def _complete_stage(state: dict, stage: str) -> None:
    if stage not in state["completed_stages"]:
        state["completed_stages"].append(stage)
    state["pending_stages"] = [item for item in state["pending_stages"] if item != stage]


def _public(state: dict) -> ProvisionStatus:
    return ProvisionStatus.model_validate({key: state[key] for key in ProvisionStatus.model_fields})


def _normalize_days(record, state: dict) -> list[SiteDay]:
    satellite = state["satellite"].get("result", {}).get("data", {}).get("result", {}).get("segmentation", {}).get("segments", {})
    context = {str(key): float(value) for key, value in satellite.items() if isinstance(value, (int, float))}
    result_days = []
    for day_key, item in sorted(state["days"].items()):
        heat_data = item["heatmap_result"]["data"]
        heat_result = heat_data["result"]
        stats = heat_result["stats_data"]["temperature_stats"]
        mean = float(stats["mean"])
        env_data = item["environment_result"]["data"]
        env_result = env_data["result"]
        timestamps = env_result.get("metadata", {}).get("timestamps", [])
        locations = env_result.get("locations", [])
        if not timestamps or not locations:
            raise ProvisioningError(f"Environmental result has no hourly series for {day_key}")
        location = locations[0]
        params = location.get("parameters", {})
        solar = location.get("solar_irradiance", {}).get("clear_sky", {}).get("ghi", 0)
        def value(name: str, index: int, fallback: float) -> float:
            values = params.get(name, [])
            raw = values[index] if index < len(values) else fallback
            return float(fallback if raw in {None, -999} else raw)
        conditions = []
        for index, timestamp in enumerate(timestamps):
            conditions.append(HourlyCondition(
                timestamp=timestamp,
                temperature_c=round(float(location.get("temperature", mean)), 2),
                apparent_temperature_c=round(value("apparent_temperature_celsius", index, mean), 2),
                wet_bulb_temperature_c=round(value("wet_bulb_temperature_celsius", index, mean), 2),
                relative_humidity_percent=round(value("relative_humidity_percent", index, 0), 2),
                solar_irradiance_ghi_wm2=round(float(solar or 0), 2),
                source="FortyGuard",
                activity_id=str(env_data.get("activity_id")),
            ))
        apparent_1500 = min(conditions, key=lambda value: abs(value.timestamp.hour - 15)).apparent_temperature_c
        cells = []
        for index, feature in enumerate(heat_result["map_data"]["features"]):
            temperature = float(feature.get("properties", {}).get("average_temperature", mean))
            cells.append(HeatCell(
                cell_id=str(feature.get("id", index)),
                geometry=feature["geometry"],
                temperature_c_1500=temperature,
                apparent_temperature_c=round(apparent_1500 + temperature - mean, 2),
                source="HeatShift-derived",
            ))
        integrity = hashlib.sha256(json.dumps({"heatmap": item["heatmap_result"], "environment": item["environment_result"]}, sort_keys=True).encode()).hexdigest()
        result_days.append(SiteDay(
            date=date.fromisoformat(day_key),
            conditions=conditions,
            heat_cells=cells,
            satellite_context=context,
            heatmap_activity_id=str(heat_data.get("activity_id")),
            environmental_activity_id=str(env_data.get("activity_id")),
            integrity_sha256=integrity,
        ))
    return result_days


provisioning_service = ProvisioningService()

