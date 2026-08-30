from __future__ import annotations

import json
import time
from typing import Any

from ..clients.llm import LLMUnavailable, ResponsesClient
from ..models.analysis import AgentOutput, AnalysisResult, ToolTrace
from .instructions import AGENT_INSTRUCTIONS
from .tools import AgentToolbox


class AgentRunner:
    MAX_ROUNDS = 6
    FALLBACK_SEQUENCE = [
        "get_site_heat",
        "load_shift_plan",
        "calculate_exposure_risk",
        "optimize_shift",
        "get_policy_guidance",
        "create_worker_alerts",
    ]

    def __init__(
        self,
        llm: ResponsesClient | None = None,
        toolbox: AgentToolbox | None = None,
    ):
        self.llm = llm or ResponsesClient()
        self.toolbox = toolbox or AgentToolbox()

    async def run(self, analysis: AnalysisResult) -> AgentOutput:
        if self.llm.available:
            try:
                return await self._run_model_loop(analysis)
            except LLMUnavailable:
                pass
        return await self._run_deterministic_fallback(analysis)

    async def _run_model_loop(self, analysis: AnalysisResult) -> AgentOutput:
        input_items: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": (
                    f"Analyze completed HeatShift analysis {analysis.analysis_id}. Call all six available "
                    "evidence, shift, risk, optimization, guidance, and alert tools before responding. "
                    "The tools are independent and may be called together."
                ),
            }
        ]
        traces: list[ToolTrace] = []
        successful_tools: set[str] = set()
        for _round in range(self.MAX_ROUNDS):
            missing_before_round = self._missing_tools(successful_tools)
            available_tools = [
                definition
                for definition in self.toolbox.definitions
                if definition["name"] in missing_before_round
            ]
            response = await self.llm.create(
                input_items,
                available_tools,
                AGENT_INSTRUCTIONS,
                tool_choice="required" if available_tools else None,
            )
            output = response.get("output", [])
            if not isinstance(output, list) or not all(isinstance(item, dict) for item in output):
                raise LLMUnavailable("Responses provider returned invalid output")
            input_items.extend(output)  # Preserve every model output item for the next round.
            calls = [item for item in output if item.get("type") == "function_call"]
            if calls:
                for call in calls:
                    call_id = call.get("call_id")
                    name = call.get("name")
                    if not call_id or not name:
                        raise LLMUnavailable("Tool call omitted call_id or name")
                    started = time.perf_counter()
                    try:
                        arguments = json.loads(call.get("arguments", "{}"))
                    except (json.JSONDecodeError, TypeError):
                        arguments = {}
                        result = {
                            "ok": False,
                            "error": {"code": "invalid_json", "message": "Tool arguments were not valid JSON"},
                        }
                    else:
                        if not isinstance(arguments, dict):
                            arguments = {}
                            result = {
                                "ok": False,
                                "error": {
                                    "code": "invalid_arguments",
                                    "message": "Tool arguments must be a JSON object",
                                },
                            }
                        else:
                            result = await self.toolbox.execute(name, arguments, analysis)
                    success = bool(result.get("ok"))
                    traces.append(
                        ToolTrace(
                            sequence=len(traces) + 1,
                            tool=name,
                            arguments=arguments,
                            latency_ms=round((time.perf_counter() - started) * 1000, 2),
                            success=success,
                            summary=self._summary(name, result),
                        )
                    )
                    if success and name in self.FALLBACK_SEQUENCE:
                        successful_tools.add(name)
                    input_items.append(
                        {"type": "function_call_output", "call_id": call_id, "output": json.dumps(result)}
                    )
                missing_tools = self._missing_tools(successful_tools)
                if missing_tools:
                    input_items.append(self._remaining_tools_message(missing_tools))
                else:
                    input_items.append(
                        {
                            "role": "user",
                            "content": "All required tools succeeded. Return the final HeatShift briefing now.",
                        }
                    )
                continue
            text = self._extract_text(response)
            if not text:
                raise LLMUnavailable("Responses provider returned no final text")
            missing_tools = self._missing_tools(successful_tools)
            if missing_tools:
                input_items.append(self._remaining_tools_message(missing_tools))
                continue
            return self._model_output(analysis, text, traces)

        missing_tools = self._missing_tools(successful_tools)
        if missing_tools:
            raise LLMUnavailable(
                "Agent exceeded the six tool rounds without completing: "
                + ", ".join(missing_tools)
            )

        # Some providers make one tool call per response even when parallel calls
        # are allowed. Reserve one tool-free request for the final briefing after
        # the six required tool rounds have completed.
        input_items.append(
            {
                "role": "user",
                "content": "All required tools succeeded. Return the final HeatShift briefing now.",
            }
        )
        response = await self.llm.create(input_items, [], AGENT_INSTRUCTIONS)
        text = self._extract_text(response)
        if not text:
            raise LLMUnavailable("Responses provider returned no final text")
        return self._model_output(analysis, text, traces)

    async def _run_deterministic_fallback(self, analysis: AnalysisResult) -> AgentOutput:
        traces: list[ToolTrace] = []
        arguments = {"analysis_id": analysis.analysis_id}
        for name in self.FALLBACK_SEQUENCE:
            started = time.perf_counter()
            result = await self.toolbox.execute(name, arguments, analysis)
            traces.append(
                ToolTrace(
                    sequence=len(traces) + 1,
                    tool=name,
                    arguments=arguments,
                    latency_ms=round((time.perf_counter() - started) * 1000, 2),
                    success=bool(result.get("ok")),
                    summary=self._summary(name, result),
                )
            )
        movements = "; ".join(
            f"move {move.task_name.lower()} from {move.from_start:%-I:%M %p} to {move.to_start:%-I:%M %p}"
            for move in analysis.movements
        )
        explanation = (
            f"HeatShift screened the fictional {analysis.site.name} shift against {len(analysis.observations)} "
            f"hourly FortyGuard observations. The highest baseline task score is "
            f"{analysis.metrics.maximum_screening_score}/100. Recommended plan: {movements}. "
            f"This reduces worker-minutes at or above the configured screening threshold from "
            f"{analysis.metrics.baseline_exposed_worker_minutes:,} to "
            f"{analysis.metrics.optimized_exposed_worker_minutes:,} "
            f"({analysis.metrics.exposure_reduction_percent:.1f}%) while retaining all scheduled task time. "
            "Fixed high-risk work still requires supervisor controls and an on-site WBGT assessment. "
            "HeatShift is screening-level decision support, not a medical diagnosis or substitute for a "
            "qualified safety professional."
        )
        return AgentOutput(
            mode="deterministic_fallback",
            explanation=explanation,
            tool_trace=traces,
            evidence_references=self._evidence_references(analysis),
            alerts=analysis.worker_alerts,
        )

    @staticmethod
    def _summary(name: str, result: dict) -> str:
        if not result.get("ok"):
            return result.get("error", {}).get("message", "Tool failed")
        data = result.get("data", {})
        if name == "get_site_heat":
            return f"Retrieved {data.get('heatmap_cells')} real heatmap cells and {data.get('observations')} observations."
        if name == "load_shift_plan":
            return f"Loaded {data.get('tasks')} tasks, {data.get('crews')} crews, {data.get('workers')} workers."
        if name == "calculate_exposure_risk":
            return f"Baseline exposure: {data.get('baseline_exposed_worker_minutes')} worker-minutes."
        if name == "optimize_shift":
            return f"Moved {data.get('tasks_moved')} tasks; reduction {data.get('exposure_reduction_percent')}%."
        if name == "get_policy_guidance":
            return "Retrieved curated NIOSH workplace heat-stress guidance."
        if name == "create_worker_alerts":
            return f"Created {len(data.get('alerts', []))} worker alert(s)."
        return "Tool completed."

    @staticmethod
    def _extract_text(response: dict) -> str:
        if isinstance(response.get("output_text"), str):
            return response["output_text"].strip()
        parts: list[str] = []
        for item in response.get("output", []):
            if item.get("type") != "message":
                continue
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"} and content.get("text"):
                    parts.append(content["text"])
        return "\n".join(parts).strip()

    def _missing_tools(self, successful_tools: set[str]) -> list[str]:
        return [name for name in self.FALLBACK_SEQUENCE if name not in successful_tools]

    @staticmethod
    def _remaining_tools_message(missing_tools: list[str]) -> dict[str, str]:
        return {
            "role": "user",
            "content": (
                "Continue the analysis. Do not repeat successful tools. Call these remaining required "
                f"tools with the same analysis_id: {', '.join(missing_tools)}."
            ),
        }

    def _model_output(
        self,
        analysis: AnalysisResult,
        text: str,
        traces: list[ToolTrace],
    ) -> AgentOutput:
        return AgentOutput(
            mode="llm_tool_calling",
            explanation=text,
            tool_trace=traces,
            evidence_references=self._evidence_references(analysis),
            alerts=analysis.worker_alerts,
        )

    @staticmethod
    def _evidence_references(analysis: AnalysisResult) -> list[str]:
        return [
            f"FortyGuard heatmap activity {analysis.data_provenance.heatmap_activity_id}",
            f"FortyGuard environmental activity {analysis.data_provenance.environmental_activity_id}",
            f"HeatShift screening policy {analysis.policy_version}",
            "https://www.cdc.gov/niosh/heat-stress/recommendations/index.html",
            "https://www.cdc.gov/niosh/heat-stress/recommendations/acclimatization.html",
        ]
