from __future__ import annotations

from typing import Any, Awaitable, Callable

from pydantic import BaseModel, ConfigDict

from ..models.analysis import AnalysisResult


class AnalysisToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")
    analysis_id: str


ToolHandler = Callable[[AnalysisResult, AnalysisToolArguments], Awaitable[dict[str, Any]]]


class AgentToolbox:
    def __init__(self):
        self.handlers: dict[str, ToolHandler] = {
            "get_site_heat": self.get_site_heat,
            "load_shift_plan": self.load_shift_plan,
            "calculate_exposure_risk": self.calculate_exposure_risk,
            "optimize_shift": self.optimize_shift,
            "get_policy_guidance": self.get_policy_guidance,
            "create_worker_alerts": self.create_worker_alerts,
        }

    @property
    def definitions(self) -> list[dict]:
        descriptions = {
            "get_site_heat": "Retrieve normalized FortyGuard heat evidence and provenance.",
            "load_shift_plan": "Load the selected site's fictional crews and task schedule.",
            "calculate_exposure_risk": "Read deterministic screening risk and exposure metrics.",
            "optimize_shift": "Read the constraint-checked before/after shift optimization.",
            "get_policy_guidance": "Retrieve curated official NIOSH heat-stress guidance links.",
            "create_worker_alerts": "Format deterministic residual-risk alerts for supervisor review.",
        }
        return [
            {
                "type": "function",
                "name": name,
                "description": descriptions[name],
                "parameters": AnalysisToolArguments.model_json_schema(),
                "strict": True,
            }
            for name in self.handlers
        ]

    async def execute(self, name: str, arguments: dict, analysis: AnalysisResult) -> dict:
        if name not in self.handlers:
            return {"ok": False, "error": {"code": "unknown_tool", "message": f"Unknown tool: {name}"}}
        try:
            validated = AnalysisToolArguments.model_validate(arguments)
        except Exception as exc:
            return {"ok": False, "error": {"code": "invalid_arguments", "message": str(exc)}}
        if validated.analysis_id != analysis.analysis_id:
            return {
                "ok": False,
                "error": {"code": "analysis_mismatch", "message": "analysis_id does not match this run"},
            }
        try:
            return {"ok": True, "data": await self.handlers[name](analysis, validated)}
        except Exception as exc:
            return {"ok": False, "error": {"code": "tool_runtime_failure", "message": str(exc)}}

    async def get_site_heat(self, analysis: AnalysisResult, _: AnalysisToolArguments) -> dict:
        return {
            "site": analysis.site.name,
            "heatmap_cells": len(analysis.heatmap_geojson.get("features", [])),
            "peak_temperature_c": analysis.metrics.peak_temperature_c,
            "peak_apparent_temperature_c": analysis.metrics.peak_apparent_temperature_c,
            "observations": len(analysis.observations),
            "provenance": analysis.data_provenance.model_dump(mode="json"),
        }

    async def load_shift_plan(self, analysis: AnalysisResult, _: AnalysisToolArguments) -> dict:
        return {
            "crews": len(analysis.crews),
            "workers": sum(crew.worker_count for crew in analysis.crews),
            "tasks": len(analysis.tasks),
            "fixed_tasks": sum(not task.movable for task in analysis.tasks),
            "fictional": analysis.site.fictional,
        }

    async def calculate_exposure_risk(self, analysis: AnalysisResult, _: AnalysisToolArguments) -> dict:
        return {
            "maximum_screening_score": analysis.metrics.maximum_screening_score,
            "highest_risk_task": analysis.metrics.highest_risk_task,
            "baseline_exposed_worker_minutes": analysis.metrics.baseline_exposed_worker_minutes,
            "threshold": 50,
            "policy_version": analysis.policy_version,
        }

    async def optimize_shift(self, analysis: AnalysisResult, _: AnalysisToolArguments) -> dict:
        return {
            "tasks_moved": analysis.metrics.tasks_moved,
            "optimized_exposed_worker_minutes": analysis.metrics.optimized_exposed_worker_minutes,
            "exposure_reduction_percent": analysis.metrics.exposure_reduction_percent,
            "productivity_retained_percent": analysis.metrics.productivity_retained_percent,
            "movements": [movement.model_dump(mode="json") for movement in analysis.movements],
        }

    async def get_policy_guidance(self, _: AnalysisResult, __: AnalysisToolArguments) -> dict:
        return {
            "guidance": [
                "Limit time in heat or increase recovery time in a cool area.",
                "Reduce physically difficult job demands and provide cool potable water nearby.",
                "Use a buddy system and an acclimatization plan for new and returning workers.",
            ],
            "sources": [
                "https://www.cdc.gov/niosh/heat-stress/recommendations/index.html",
                "https://www.cdc.gov/niosh/heat-stress/recommendations/acclimatization.html",
            ],
        }

    async def create_worker_alerts(self, analysis: AnalysisResult, _: AnalysisToolArguments) -> dict:
        return {"alerts": [alert.model_dump(mode="json") for alert in analysis.worker_alerts]}
