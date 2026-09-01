from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from ..clients.llm import LLMUnavailable, ResponsesClient
from ..models.weekly import QuestionResponse, WeeklyAnalysis
from .weekly_store import WorkspaceRecord


NUMBER_PATTERN = re.compile(r"(?<![A-Za-z])\d+(?:\.\d+)?")


def _allowed_numbers(analysis: WeeklyAnalysis) -> set[str]:
    serialized = json.dumps(analysis.model_dump(mode="json"), separators=(",", ":"))
    values = set(NUMBER_PATTERN.findall(serialized))
    values.update({"35", "50", "100", "0", "1", "7", "30"})
    return values


def is_numerically_grounded(text: str, analysis: WeeklyAnalysis) -> bool:
    return set(NUMBER_PATTERN.findall(text)).issubset(_allowed_numbers(analysis))


def deterministic_answer(question: str, analysis: WeeklyAnalysis, context: dict) -> str:
    key = str(context.get("metric") or "").lower()
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
            if text and is_numerically_grounded(text, analysis):
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

