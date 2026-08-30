from __future__ import annotations

import asyncio
import copy
import json

from app.agent.runner import AgentRunner
from app.agent.tools import AgentToolbox
from app.services.analysis_service import AnalysisService


def analysis():
    return asyncio.run(AnalysisService().run_demo())


class StubLLM:
    available = True

    def __init__(self, responses: list[dict]):
        self.responses = responses
        self.requests: list[list[dict]] = []

    async def create(
        self,
        input_items: list[dict],
        tools: list[dict],
        instructions: str,
        tool_choice: str | None = None,
    ) -> dict:
        self.requests.append(copy.deepcopy(input_items))
        if self.responses:
            return self.responses.pop(0)
        return {"output": []}


def tool_call(call_id: str, name: str, analysis_id: str, arguments: str | None = None) -> dict:
    return {
        "type": "function_call",
        "call_id": call_id,
        "name": name,
        "arguments": arguments if arguments is not None else json.dumps({"analysis_id": analysis_id}),
    }


def final_response(text: str = "Evidence-backed HeatShift briefing.") -> dict:
    return {
        "output_text": text,
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


def test_unknown_tool_is_a_recoverable_output() -> None:
    result = asyncio.run(
        AgentToolbox().execute("does_not_exist", {"analysis_id": "x"}, analysis())
    )
    assert result["ok"] is False
    assert result["error"]["code"] == "unknown_tool"


def test_invalid_arguments_are_rejected() -> None:
    result = asyncio.run(AgentToolbox().execute("get_site_heat", {}, analysis()))
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_arguments"


def test_llm_unavailable_uses_six_tool_fallback() -> None:
    result = analysis()
    output = asyncio.run(AgentRunner().run(result))
    assert output.mode == "deterministic_fallback"
    assert [trace.tool for trace in output.tool_trace] == AgentRunner.FALLBACK_SEQUENCE
    assert all(trace.success for trace in output.tool_trace)
    assert "78.0%" in output.explanation


def test_model_loop_batches_all_required_tools_and_returns_text() -> None:
    result = analysis()
    llm = StubLLM(
        [
            {
                "output": [
                    tool_call(f"call-{index}", name, result.analysis_id)
                    for index, name in enumerate(AgentRunner.FALLBACK_SEQUENCE, start=1)
                ]
            },
            final_response(),
        ]
    )

    output = asyncio.run(AgentRunner(llm=llm).run(result))

    assert output.mode == "llm_tool_calling"
    assert output.explanation == "Evidence-backed HeatShift briefing."
    assert [trace.tool for trace in output.tool_trace] == AgentRunner.FALLBACK_SEQUENCE
    assert all(trace.success for trace in output.tool_trace)
    assert len(llm.requests) == 2
    returned_outputs = [
        item for item in llm.requests[1] if item.get("type") == "function_call_output"
    ]
    assert len(returned_outputs) == 6


def test_six_sequential_tool_rounds_get_a_separate_finalization_request() -> None:
    result = analysis()
    llm = StubLLM(
        [
            {"output": [tool_call(f"call-{index}", name, result.analysis_id)]}
            for index, name in enumerate(AgentRunner.FALLBACK_SEQUENCE, start=1)
        ]
        + [final_response("Finalized after sequential tools")]
    )

    output = asyncio.run(AgentRunner(llm=llm).run(result))

    assert output.mode == "llm_tool_calling"
    assert output.explanation == "Finalized after sequential tools"
    assert len(llm.requests) == AgentRunner.MAX_ROUNDS + 1
    assert [trace.tool for trace in output.tool_trace] == AgentRunner.FALLBACK_SEQUENCE
    assert all(trace.success for trace in output.tool_trace)


def test_model_cannot_finalize_before_calling_every_required_tool() -> None:
    result = analysis()
    first_tool = AgentRunner.FALLBACK_SEQUENCE[0]
    remaining = AgentRunner.FALLBACK_SEQUENCE[1:]
    llm = StubLLM(
        [
            {"output": [tool_call("call-1", first_tool, result.analysis_id)]},
            final_response("Premature answer"),
            {
                "output": [
                    tool_call(f"call-{index}", name, result.analysis_id)
                    for index, name in enumerate(remaining, start=2)
                ]
            },
            final_response("Complete answer"),
        ]
    )

    output = asyncio.run(AgentRunner(llm=llm).run(result))

    assert output.mode == "llm_tool_calling"
    assert output.explanation == "Complete answer"
    assert len(output.tool_trace) == 6
    assert "get_site_heat" not in llm.requests[2][-1]["content"]
    assert "load_shift_plan" in llm.requests[2][-1]["content"]


def test_invalid_json_is_returned_and_recorded_before_retry() -> None:
    result = analysis()
    llm = StubLLM(
        [
            {
                "output": [
                    tool_call(
                        "call-invalid",
                        "get_site_heat",
                        result.analysis_id,
                        arguments="{not-json",
                    )
                ]
            },
            {
                "output": [
                    tool_call(f"call-{index}", name, result.analysis_id)
                    for index, name in enumerate(AgentRunner.FALLBACK_SEQUENCE, start=1)
                ]
            },
            final_response(),
        ]
    )

    output = asyncio.run(AgentRunner(llm=llm).run(result))

    assert output.mode == "llm_tool_calling"
    assert output.tool_trace[0].tool == "get_site_heat"
    assert output.tool_trace[0].success is False
    assert output.tool_trace[0].summary == "Tool arguments were not valid JSON"
    invalid_item = next(
        item
        for item in reversed(llm.requests[1])
        if item.get("type") == "function_call_output"
    )
    invalid_output = json.loads(invalid_item["output"])
    assert invalid_output["error"]["code"] == "invalid_json"


def test_missing_tool_identity_falls_back_safely() -> None:
    result = analysis()
    llm = StubLLM(
        [
            {
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "arguments": json.dumps({"analysis_id": result.analysis_id}),
                    }
                ]
            }
        ]
    )

    output = asyncio.run(AgentRunner(llm=llm).run(result))

    assert output.mode == "deterministic_fallback"
    assert len(output.tool_trace) == 6


def test_empty_model_output_falls_back_safely() -> None:
    result = analysis()
    output = asyncio.run(AgentRunner(llm=StubLLM([{"output": []}])).run(result))
    assert output.mode == "deterministic_fallback"


def test_maximum_model_rounds_fall_back_safely() -> None:
    result = analysis()
    llm = StubLLM(
        [
            {"output": [tool_call(f"call-{index}", "get_site_heat", result.analysis_id)]}
            for index in range(AgentRunner.MAX_ROUNDS)
        ]
    )

    output = asyncio.run(AgentRunner(llm=llm).run(result))

    assert output.mode == "deterministic_fallback"
    assert len(llm.requests) == AgentRunner.MAX_ROUNDS


def test_tool_runtime_failure_is_recoverable() -> None:
    result = analysis()
    toolbox = AgentToolbox()

    async def fail(*_):
        raise RuntimeError("simulated tool failure")

    toolbox.handlers["get_site_heat"] = fail
    tool_result = asyncio.run(
        toolbox.execute("get_site_heat", {"analysis_id": result.analysis_id}, result)
    )

    assert tool_result["ok"] is False
    assert tool_result["error"]["code"] == "tool_runtime_failure"
