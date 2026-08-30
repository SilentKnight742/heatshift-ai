from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from ..config import ROOT_DIR, Settings, settings
from ..models.weather import DataProvenance, EnvironmentalObservation, HeatDataBundle


class FortyGuardError(RuntimeError):
    """Raised when a FortyGuard request cannot produce a usable result."""


class FortyGuardClient:
    """Small async FortyGuard client with explicit real-response fallback."""

    def __init__(self, config: Settings = settings, client: httpx.AsyncClient | None = None):
        self.config = config
        self._client = client
        self.last_request_id: str | None = None
        self.last_live_error: str | None = None
        self.cache_dir = ROOT_DIR / "data/cache"

    @property
    def configured(self) -> bool:
        return bool(self.config.fortyguard_api_key)

    async def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        if not self.config.fortyguard_api_key:
            raise FortyGuardError("FORTYGUARD_API_KEY is not configured")
        self.last_request_id = str(uuid.uuid4())
        headers = {
            "api-key": self.config.fortyguard_api_key,
            "content-type": "application/json",
            "x-request-id": self.last_request_id,
        }
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=45)
        try:
            for attempt in range(3):
                try:
                    response = await client.request(
                        method,
                        f"{self.config.fortyguard_base_url.rstrip('/')}{path}",
                        headers=headers,
                        json=payload,
                    )
                    if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                        await asyncio.sleep(1.5 * (attempt + 1))
                        continue
                    response.raise_for_status()
                    return response.json()
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    if attempt == 2:
                        raise FortyGuardError(f"FortyGuard network error: {exc}") from exc
                    await asyncio.sleep(1.5 * (attempt + 1))
                except httpx.HTTPStatusError as exc:
                    detail = exc.response.text[:500]
                    raise FortyGuardError(
                        f"FortyGuard returned HTTP {exc.response.status_code}: {detail}"
                    ) from exc
            raise FortyGuardError("FortyGuard request exhausted retries")
        finally:
            if owns_client:
                await client.aclose()

    @staticmethod
    def cache_key(polygon: dict, date_time: dict, granularity: int, analytic_type: str) -> str:
        canonical = json.dumps(
            {
                "polygon": polygon,
                "date_time": date_time,
                "granularity": granularity,
                "analytic_type": analytic_type,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode()).hexdigest()

    async def submit_heatmap(
        self,
        polygon: dict,
        date_time: dict,
        granularity: int = 100,
        analytic_type: str = "tcm",
    ) -> str:
        if granularity not in {60, 80, 100}:
            raise ValueError("granularity must be 60, 80, or 100 metres")
        self._validate_polygon(polygon)
        response = await self._request(
            "POST",
            "/v1/heatmap",
            {
                "polygon_aoi": polygon,
                "date_time": date_time,
                "granularity": granularity,
                "analytic_type": analytic_type,
            },
        )
        activity_id = response.get("data", {}).get("activity_id")
        if not activity_id:
            raise FortyGuardError("Heatmap submission did not return an activity ID")
        return str(activity_id)

    async def submit_environmental_parameters(
        self,
        latitude: float,
        longitude: float,
        temperature: float,
        date_time: dict,
    ) -> str:
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise ValueError("invalid latitude or longitude")
        response = await self._request(
            "POST",
            "/v1/env_params",
            {
                "latitude": latitude,
                "longitude": longitude,
                "temperature": temperature,
                "date_time": date_time,
            },
        )
        activity_id = response.get("data", {}).get("activity_id")
        if not activity_id:
            raise FortyGuardError("Environmental submission did not return an activity ID")
        return str(activity_id)

    async def get_activity_status(self, activity_id: str) -> dict:
        if not activity_id or "/" in activity_id:
            raise ValueError("invalid activity ID")
        return await self._request("GET", f"/v1/status/{activity_id}")

    async def wait_for_activity(
        self,
        activity_id: str,
        max_attempts: int = 30,
        initial_delay: float = 2.0,
    ) -> dict:
        for attempt in range(max_attempts):
            response = await self.get_activity_status(activity_id)
            status = str(response.get("data", {}).get("status", "unknown")).lower()
            if status in {"completed", "succeeded"}:
                return response
            if status in {"failed", "error"}:
                raise FortyGuardError(f"Activity {activity_id} failed")
            await asyncio.sleep(min(initial_delay + attempt, 10))
        raise FortyGuardError(f"Activity {activity_id} did not complete in time")

    async def get_heat_forecast(self) -> HeatDataBundle:
        """Return the demo replay from live calls or a labelled real cached response."""
        if self.config.fortyguard_mode == "live":
            try:
                return await self._fetch_live_demo()
            except Exception as exc:
                self.last_live_error = str(exc)
                return self._load_cached_demo(mode="cached_after_live_failure")
        return self._load_cached_demo(mode="cached")

    async def _fetch_live_demo(self) -> HeatDataBundle:
        cached = json.loads((self.cache_dir / "fortyguard_demo_response.json").read_text())
        request = cached["request"]
        activity_id = await self.submit_heatmap(
            request["polygon_aoi"],
            request["date_time"],
            request.get("granularity", 100),
        )
        heatmap = await self.wait_for_activity(activity_id)
        stats = heatmap["data"]["result"]["stats_data"]["temperature_stats"]
        env_request = json.loads(
            (self.cache_dir / "fortyguard_environment_response.json").read_text()
        )["request"]
        env_id = await self.submit_environmental_parameters(
            env_request["latitude"],
            env_request["longitude"],
            stats["mean"],
            env_request["date_time"],
        )
        environment = await self.wait_for_activity(env_id)
        captured_at = datetime.now(timezone.utc)
        return self._normalize(
            heatmap,
            environment,
            captured_at,
            request,
            mode="live",
        )

    def _load_cached_demo(self, mode: str) -> HeatDataBundle:
        heatmap_path = self.cache_dir / "fortyguard_demo_response.json"
        environment_path = self.cache_dir / "fortyguard_environment_response.json"
        if not heatmap_path.exists() or not environment_path.exists():
            raise FortyGuardError("No successful real FortyGuard cached response is available")
        heatmap_fixture = json.loads(heatmap_path.read_text())
        environment_fixture = json.loads(environment_path.read_text())
        captured_at = min(
            datetime.fromisoformat(heatmap_fixture["captured_at"].replace("Z", "+00:00")),
            datetime.fromisoformat(environment_fixture["captured_at"].replace("Z", "+00:00")),
        )
        return self._normalize(
            heatmap_fixture["response"],
            environment_fixture["response"],
            captured_at,
            heatmap_fixture["request"],
            mode=mode,
        )

    @staticmethod
    def _normalize_missing(value: Any) -> float | None:
        if value is None or value == -999:
            return None
        return float(value)

    def _normalize(
        self,
        heatmap_response: dict,
        environment_response: dict,
        captured_at: datetime,
        heatmap_request: dict,
        mode: str,
    ) -> HeatDataBundle:
        heat_data = heatmap_response.get("data", {})
        env_data = environment_response.get("data", {})
        heat_result = heat_data.get("result", {})
        env_result = env_data.get("result", {})
        map_data = heat_result.get("map_data", {})
        if not map_data.get("features"):
            raise FortyGuardError("FortyGuard heatmap completed without map cells")
        locations = env_result.get("locations", [])
        timestamps = env_result.get("metadata", {}).get("timestamps", [])
        if not locations or not timestamps:
            raise FortyGuardError("FortyGuard environmental result has no observations")
        location = locations[0]
        params = location.get("parameters", {})
        solar = location.get("solar_irradiance", {}).get("clear_sky", {})

        def item(name: str, index: int) -> float | None:
            values = params.get(name, [])
            return self._normalize_missing(values[index] if index < len(values) else None)

        observations = [
            EnvironmentalObservation(
                timestamp=timestamp,
                latitude=location["lat"],
                longitude=location["lon"],
                apparent_temperature_c=item("apparent_temperature_celsius", index),
                heat_index_c=item("heat_index_celsius", index),
                wet_bulb_temperature_c=item("wet_bulb_temperature_celsius", index),
                relative_humidity_percent=item("relative_humidity_percent", index),
                solar_irradiance_ghi_wm2=self._normalize_missing(solar.get("ghi")),
                source="FortyGuard environmental parameters",
                activity_id=str(env_data.get("activity_id")),
            )
            for index, timestamp in enumerate(timestamps)
        ]
        time_range = env_result["metadata"]["time_range"]
        label = (
            "Live FortyGuard"
            if mode == "live"
            else f"Cached FortyGuard response captured at {captured_at.isoformat()}"
        )
        return HeatDataBundle(
            heatmap_geojson=map_data,
            temperature_stats=heat_result["stats_data"]["temperature_stats"],
            observations=observations,
            provenance=DataProvenance(
                source_label=label,
                captured_at=captured_at,
                heatmap_activity_id=str(heat_data.get("activity_id")),
                environmental_activity_id=str(env_data.get("activity_id")),
                heatmap_timestamp=(
                    f"{heatmap_request['date_time']['start_date']}T"
                    f"{heatmap_request['date_time']['start_time']}:00-07:00"
                ),
                environmental_time_range=f"{time_range['start']} to {time_range['end']}",
                mode=mode,
            ),
        )

    @staticmethod
    def _validate_polygon(polygon: dict) -> None:
        if polygon.get("type") != "FeatureCollection" or not polygon.get("features"):
            raise ValueError("polygon must be a non-empty GeoJSON FeatureCollection")
        ring = polygon["features"][0].get("geometry", {}).get("coordinates", [[]])[0]
        if len(ring) < 4 or ring[0] != ring[-1]:
            raise ValueError("polygon must contain a closed ring")
        for longitude, latitude in ring:
            if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
                raise ValueError("polygon contains an invalid coordinate")

