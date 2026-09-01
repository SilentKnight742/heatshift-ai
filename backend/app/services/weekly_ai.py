from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from ..clients.llm import LLMUnavailable, ResponsesClient
from ..models.weekly import QuestionResponse, WeeklyAnalysis, WeeklyCrew, WeeklyJob, SiteDay
if TYPE_CHECKING:
    from .weekly_store import WorkspaceRecord


NUMBER_PATTERN = re.compile(r"(?<![A-Za-z])\d+(?:\.\d+)?")


def retrieve_weekly_context(
    days: list[SiteDay], jobs: list[WeeklyJob], crews: list[WeeklyCrew], analysis: WeeklyAnalysis
) -> dict[str, Any]:
    """Deterministic retrieval tools used to ground contextual explanation."""
    jobs_by_id = {job.job_id: job for job in jobs}
    return {
        "retrieve_week_conditions": [
            {
                "date": day.date.isoformat(),
                "peak_apparent_temperature_c": max(item.apparent_temperature_c for item in day.conditions),
                "mean_apparent_temperature_c": round(sum(item.apparent_temperature_c for item in day.conditions) / len(day.conditions), 2),
                "source": sorted({item.source for item in day.conditions}),
            }
            for day in days
        ],
        "retrieve_jobs": [
            {
                "job_id": job.job_id, "name": job.name, "status": job.status,
                "duration_minutes": job.duration_minutes, "workload": job.workload,
                "movable": job.movable, "assigned_crew_id": job.assigned_crew_id,
            }
            for job in jobs
        ],
        "retrieve_metric_breakdowns": {
            key: value.model_dump(mode="json") for key, value in analysis.explanations.items()
        },
        "retrieve_plan_comparisons": {
            layer: metrics.model_dump(mode="json") for layer, metrics in analysis.plan_metrics.items()
        },
        "retrieve_residual_alerts": [
            {
                "job_id": entry.job_id,
                "job_name": jobs_by_id.get(entry.job_id).name if jobs_by_id.get(entry.job_id) else entry.job_id,
                "crew_id": entry.crew_id,
                "screening_score": entry.screening_score,
                "start": entry.start.isoformat(),
            }
            for entry in analysis.working if entry.screening_score >= 50
        ],
        "retrieve_guidance": {
            "summary": [
                "Limit time in heat or increase cool-area recovery time.",
                "Reduce demanding work and provide cool potable water nearby.",
                "Use buddy and acclimatization plans for new and returning workers.",
            ],
            "sources": [
                "https://www.cdc.gov/niosh/heat-stress/recommendations/index.html",
                "https://www.cdc.gov/niosh/heat-stress/recommendations/acclimatization.html",
            ],
        },
        "crew_count": len(crews),
    }


def _number_variants(payload: Any) -> set[str]:
    serialized = json.dumps(payload, separators=(",", ":"), default=str)
    values = set(NUMBER_PATTERN.findall(serialized))
    for value in list(values):
        try:
            numeric = float(value)
            if numeric.is_integer():
                values.add(str(int(numeric)))
                values.add(f"{numeric:.1f}")
        except ValueError:
            pass
    return values


def _allowed_numbers(analysis: WeeklyAnalysis, context: dict | None = None) -> set[str]:
    schedule_values = [{"start": item.start, "end": item.end, "score": item.screening_score} for item in analysis.working]
    values = _number_variants({"metrics": analysis.metrics.model_dump(mode="json"), "schedule": schedule_values, "context": context or {}})
    values.update({"35", "50", "100", "0", "1", "7", "30"})
    return values


def is_numerically_grounded(text: str, analysis: WeeklyAnalysis, context: dict | None = None) -> bool:
    return set(NUMBER_PATTERN.findall(text)).issubset(_allowed_numbers(analysis, context))


def contradicts_analysis(text: str, analysis: WeeklyAnalysis) -> bool:
    lowered = " ".join(text.lower().split())
    metrics = analysis.metrics
    if metrics.residual_alerts > 0 and any(phrase in lowered for phrase in ("no residual risk", "no residual alert", "all risk eliminated", "risk is eliminated")):
        return True
    if metrics.tasks_rescheduled == 0 and any(phrase in lowered for phrase in ("tasks were rescheduled", "jobs were rescheduled", "apply the proposed moves")):
        return True
    if metrics.productive_task_time_retained_percent < 100 and any(phrase in lowered for phrase in ("all work is retained", "full productivity is retained", "no work is lost")):
        return True
    if not metrics.constraint_valid and "constraint-valid" in lowered:
        return True
    return False


async def generate_weekly_briefing(analysis: WeeklyAnalysis, site_name: str) -> tuple[str, str]:
    client = ResponsesClient()
    if not client.available:
        return analysis.briefing_markdown, "deterministic_fallback"
    instructions = (
        "Write a concise 180-220 word operational brief in Markdown with exactly four level-2 headings: "
        "Decision, Why, Next actions, Still exposed. Start with the decision. Avoid filler and do not restate the product. "
        "Use only the authoritative JSON. Do not invent a number, change a plan, claim medical accuracy, injury prevention, "
        "global optimality, or elimination of risk. Keep the screening limitation in Still exposed."
    )
    input_items = [{"role": "user", "content": json.dumps({
        "site_name": site_name,
        "authoritative_metrics": analysis.metrics.model_dump(mode="json"),
        "recommendations": analysis.recommendations,
        "limitations": analysis.limitations,
        "working_plan": [item.model_dump(mode="json") for item in analysis.working],
    })}]
    try:
        response = await client.create(input_items, [], instructions)
        text = _extract_text(response)
        words = len(text.split())
        headings = [line.strip() for line in text.splitlines() if line.startswith("## ")]
        if (
            text
            and 140 <= words <= 260
            and headings == ["## Decision", "## Why", "## Next actions", "## Still exposed"]
            and is_numerically_grounded(text, analysis)
            and not contradicts_analysis(text, analysis)
        ):
            return text, "llm_grounded"
    except LLMUnavailable:
        pass
    return analysis.briefing_markdown, "deterministic_fallback"


def deterministic_answer(question: str, analysis: WeeklyAnalysis, context: dict) -> str:
    selected = context.get("selected_metric") if isinstance(context.get("selected_metric"), dict) else {}
    key = str(context.get("key") or context.get("metric") or selected.get("metric") or "").lower()
    if "thermal" in key or "heat" in question.lower():
        return analysis.explanations["thermal_burden"].comparison + " " + analysis.explanations["thermal_burden"].limitations[0]
    if "crew" in key or "crew" in question.lower():
        return analysis.explanations["crew_load"].comparison + " This is a planning indicator, not a measured worker dose."
    if "disruption" in key or "move" in question.lower():
        return analysis.explanations["disruption"].comparison + " Open the Working plan to accept, undo or revise individual movements."
    if "risk" in key or "reduction" in question.lower():
        return analysis.explanations["risk_reduction"].comparison + " The result changes if the disclosed threshold changes."
    return (
        "HeatShift can explain the selected site, job, crew, metric or plan comparison. "
        "The schedule and metrics remain deterministic; this answer cannot change them."
    )


async def answer_question(
    workspace: WorkspaceRecord,
    question: str,
    context: dict,
    analysis: WeeklyAnalysis,
) -> QuestionResponse:
    day_key = datetime.now(timezone.utc).date().isoformat()
    used = workspace.questions_by_day.get(day_key, 0)
    if used >= 20:
        return QuestionResponse(
            answer_markdown=deterministic_answer(question, analysis, context),
            mode="deterministic_limit_fallback",
            remaining_today=0,
        )
    workspace.questions_by_day[day_key] = used + 1
    remaining = 19 - used
    client = ResponsesClient()
    if client.available:
        instructions = (
            "You explain one completed HeatShift weekly analysis. Answer in under 120 words. "
            "Use only the provided authoritative JSON. Do not invent numbers, change schedules, claim medical accuracy, "
            "or imply injury prevention. Use concise Markdown without raw HTML."
        )
        input_items = [{
            "role": "user",
            "content": json.dumps({
                "question": question,
                "selected_context": context,
                "authoritative_analysis": analysis.model_dump(mode="json"),
            }),
        }]
        try:
            response = await client.create(input_items, [], instructions)
            text = _extract_text(response)
            if text and is_numerically_grounded(text, analysis, context) and not contradicts_analysis(text, analysis):
                return QuestionResponse(answer_markdown=text, mode="llm_grounded", remaining_today=remaining)
        except LLMUnavailable:
            pass
    return QuestionResponse(
        answer_markdown=deterministic_answer(question, analysis, context),
        mode="deterministic_fallback",
        remaining_today=remaining,
    )


def _extract_text(response: dict) -> str:
    if isinstance(response.get("output_text"), str):
        return response["output_text"].strip()
    parts = []
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                parts.append(content["text"])
    return "\n".join(parts).strip()
