from __future__ import annotations

import asyncio

from app.agent.runner import AgentRunner
from app.services.analysis_service import AnalysisService


def test_fixture_to_agent_integration_runs_without_network() -> None:
    result = asyncio.run(AnalysisService().run_demo())
    result.agent = asyncio.run(AgentRunner().run(result))
    assert result.status.value == "completed"
    assert len(result.heatmap_geojson["features"]) == 198
    assert result.movements
    assert result.agent.tool_trace[-1].tool == "create_worker_alerts"
    assert result.data_provenance.source_label.startswith("Cached FortyGuard response captured at")

