from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from ..clients.fortyguard import FortyGuardClient
from ..config import ROOT_DIR
from ..models.analysis import (
    AnalysisResult,
    AnalysisStatus,
    Metrics,
    Recommendation,
    ScheduleItem,
    WorkerAlert,
)
from ..models.crew import Crew
from ..models.site import GeoPoint, Site
from ..models.scenario import ScenarioAnalysisRequest
from ..models.task import ShiftPlan
from ..models.weather import EnvironmentalObservation
from .cache import AnalysisStore, analysis_store
from .risk_engine import RiskEngine
from .schedule_optimizer import ScheduleOptimizer


class AnalysisService:
    def __init__(
        self,
        fortyguard: FortyGuardClient | None = None,
        risk_engine: RiskEngine | None = None,
        store: AnalysisStore = analysis_store,
    ):
        self.fortyguard = fortyguard or FortyGuardClient()
        self.risk_engine = risk_engine or RiskEngine()
        self.optimizer = ScheduleOptimizer(self.risk_engine)
        self.store = store

    def load_demo_scenario(self) -> tuple[Site, list[Crew], ShiftPlan]:
        demo_dir = ROOT_DIR / "data/demo"
        site_geojson = json.loads((demo_dir / "site.geojson").read_text())
        crews = [Crew.model_validate(item) for item in json.loads((demo_dir / "crews.json").read_text())]
        shift = ShiftPlan.model_validate_json((demo_dir / "shift.json").read_text())
        site = Site(
            site_id="desertline-yard",
            name="DesertLine Logistics Yard",
            polygon=site_geojson,
            timezone="America/Phoenix",
            surface_type="paved logistics yard",
            shade_available=True,
            cooling_zone_coordinates=GeoPoint(longitude=-112.0718, latitude=33.4504),
            fictional=True,
        )
        return site, crews, shift

    async def create_demo_job(self) -> str:
        analysis_id = str(uuid.uuid4())
        await self.store.create(analysis_id)
        return analysis_id

    async def run_demo(self, analysis_id: str | None = None) -> AnalysisResult:
        site, crews, shift = self.load_demo_scenario()
        return await self._run_operation(site, crews, shift, analysis_id, persist=True)

    async def run_scenario(
        self,
        request: ScenarioAnalysisRequest,
        analysis_id: str | None = None,
    ) -> AnalysisResult:
        return await self._run_operation(
            request.site,
            request.crews,
            request.shift,
            analysis_id,
            persist=False,
        )

    async def _run_operation(
        self,
        site: Site,
        crews: list[Crew],
        shift: ShiftPlan,
        analysis_id: str | None = None,
        *,
        persist: bool,
    ) -> AnalysisResult:
        analysis_id = analysis_id or str(uuid.uuid4())
        created_at = datetime.now(timezone.utc)
        if persist:
            if await self.store.get(analysis_id) is None:
                stored = await self.store.create(analysis_id)
            else:
                stored = await self.store.get(analysis_id)
            created_at = stored.created_at  # type: ignore[union-attr]
        try:
            if persist:
                await self.store.update_status(analysis_id, AnalysisStatus.FETCHING_HEAT)
            heat = await self.fortyguard.get_heat_forecast()
            observations = self._align_observations(heat.observations, shift)
            crew_by_id = {crew.crew_id: crew for crew in crews}

            if persist:
                await self.store.update_status(analysis_id, AnalysisStatus.CALCULATING_RISK)
            baseline = self.risk_engine.assess_schedule(
                shift.tasks, crew_by_id, observations
            )

            if persist:
                await self.store.update_status(analysis_id, AnalysisStatus.OPTIMIZING)
            optimized_tasks, optimized, movements = self.optimizer.optimize(
                shift.tasks, crew_by_id, observations
            )
            metrics = self._metrics(heat.temperature_stats, observations, baseline, optimized, movements)
            recommendations = self._recommendations(movements, optimized, crews)
            alerts = self._alerts(optimized)
            now = datetime.now(timezone.utc)
            result = AnalysisResult(
                analysis_id=analysis_id,
                status=AnalysisStatus.COMPLETED,
                created_at=created_at,
                completed_at=now,
                site=site,
                crews=crews,
                tasks=optimized_tasks,
                heatmap_geojson=heat.heatmap_geojson,
                observations=observations,
                baseline_schedule=baseline,
                optimized_schedule=optimized,
                movements=movements,
                metrics=metrics,
                recommendations=recommendations,
                worker_alerts=alerts,
                data_provenance=heat.provenance,
                policy_version=self.risk_engine.policy["version"],
                limitations=[
                    "HeatShift provides screening-level decision support using ambient and environmental data.",
                    "It does not replace an on-site WBGT meter or a qualified safety professional.",
                    "Risk bands are product screening bands, not medical diagnoses or regulatory exposure limits.",
                    "All site, crew, and task operational inputs are fictional in this build; FortyGuard data and activity IDs are real.",
                ],
            )
            if persist:
                await self.store.complete(analysis_id, result)
            return result
        except Exception as exc:
            if persist:
                await self.store.fail(analysis_id, str(exc))
            raise

    @staticmethod
    def _align_observations(
        observations: list[EnvironmentalObservation],
        shift: ShiftPlan,
    ) -> list[EnvironmentalObservation]:
        """Preserve the measured hourly profile while aligning it to the scenario date."""
        aligned: list[EnvironmentalObservation] = []
        for observation in observations:
            timestamp = shift.shift_start.replace(
                hour=observation.timestamp.hour,
                minute=observation.timestamp.minute,
                second=observation.timestamp.second,
                microsecond=observation.timestamp.microsecond,
            )
            aligned.append(observation.model_copy(update={"timestamp": timestamp}))
        return aligned

    @staticmethod
    def _metrics(
        temperature_stats: dict[str, float],
        observations,
        baseline: list[ScheduleItem],
        optimized: list[ScheduleItem],
        movements,
    ) -> Metrics:
        baseline_exposure = sum(item.exposed_worker_minutes for item in baseline)
        optimized_exposure = sum(item.exposed_worker_minutes for item in optimized)
        reduction = (
            (baseline_exposure - optimized_exposure) / baseline_exposure * 100
            if baseline_exposure
            else 0.0
        )
        highest = max(baseline, key=lambda item: item.peak_risk)
        apparent_values = [
            item.apparent_temperature_c
            for item in observations
            if item.apparent_temperature_c is not None
        ]
        return Metrics(
            peak_temperature_c=round(temperature_stats["maximum"], 1),
            peak_apparent_temperature_c=round(max(apparent_values), 1),
            maximum_screening_score=highest.peak_risk,
            highest_risk_task=highest.task_name,
            baseline_exposed_worker_minutes=baseline_exposure,
            optimized_exposed_worker_minutes=optimized_exposure,
            exposure_reduction_percent=round(reduction, 1),
            schedule_disruption_minutes=sum(movement.minutes_moved for movement in movements),
            productivity_retained_percent=100.0,
            tasks_moved=len(movements),
        )

    @staticmethod
    def _recommendations(
        movements,
        optimized: list[ScheduleItem],
        crews: list[Crew],
    ) -> list[Recommendation]:
        recommendations = [
            Recommendation(
                priority="high",
                title=f"Move {movement.task_name.lower()} to {movement.to_start:%-I:%M %p}",
                detail=movement.reason,
                evidence=f"Original start {movement.from_start:%-I:%M %p}; preserves task duration and crew constraints.",
            )
            for movement in movements
        ]
        fixed_high = [item for item in optimized if not item.movable and item.peak_risk >= 50]
        if fixed_high:
            names = ", ".join(item.task_name for item in fixed_high)
            recommendations.append(
                Recommendation(
                    priority="critical",
                    title="Escalate fixed high-risk work",
                    detail=(
                        f"{names} cannot move. Obtain an on-site WBGT reading and have the qualified "
                        "safety lead set work/rest controls before proceeding."
                    ),
                    evidence="Fixed schedule constraint plus a screening score at or above 50.",
                )
            )
        new_crews = [crew.name for crew in crews if crew.acclimatization_status.value == "new"]
        if new_crews:
            recommendations.append(
                Recommendation(
                    priority="high",
                    title="Apply the new-worker acclimatization plan",
                    detail=(
                        f"Closely supervise {', '.join(new_crews)} and assign lighter work with longer, "
                        "more frequent recovery periods."
                    ),
                    evidence="NIOSH identifies new-worker acclimatization as a distinct heat-risk control.",
                )
            )
        recommendations.append(
            Recommendation(
                priority="medium",
                title="Stage water and shaded recovery at Zone B",
                detail="Confirm cool potable water, buddy checks, and a shaded recovery area before shift start.",
                evidence="NIOSH workplace heat-stress recommendations: hydration, recovery time, and buddy monitoring.",
            )
        )
        return recommendations

    @staticmethod
    def _alerts(optimized: list[ScheduleItem]) -> list[WorkerAlert]:
        alerts = []
        for item in sorted(optimized, key=lambda row: row.peak_risk, reverse=True):
            if item.peak_risk < 50:
                continue
            alerts.append(
                WorkerAlert(
                    alert_id=f"alert-{item.task_id}",
                    severity=item.peak_band,
                    headline=f"{item.peak_band.upper()} HEAT RISK",
                    task_name=item.task_name,
                    crew_name=item.crew_name,
                    message=f"Screening score {item.peak_risk}/100 during this work window.",
                    next_action="Move to Shade Zone B for supervisor-directed recovery and assessment.",
                )
            )
        return alerts
