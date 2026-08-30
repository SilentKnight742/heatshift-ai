from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from ..agent.runner import AgentRunner
from ..models.analysis import AnalysisJob, AnalysisResult
from ..models.scenario import ScenarioAnalysisRequest
from ..services.analysis_service import AnalysisService
from ..services.cache import analysis_store


router = APIRouter(prefix="/api", tags=["analysis"])
service = AnalysisService(store=analysis_store)
agent_runner = AgentRunner()


class AnalysisCreateRequest(BaseModel):
    """The narrow slice accepts an empty body and runs its bundled demo scenario."""

    model_config = ConfigDict(extra="forbid")


async def _complete_job(analysis_id: str) -> AnalysisJob:
    result = await service.run_demo(analysis_id)
    result.agent = await agent_runner.run(result)
    await analysis_store.complete(analysis_id, result)
    job = await analysis_store.get(analysis_id)
    assert job is not None
    return job


def _is_analysis_id(value: str) -> bool:
    try:
        return str(UUID(value)) == value.lower()
    except ValueError:
        return False


async def _get_or_replay_job(analysis_id: str) -> AnalysisJob:
    job = await analysis_store.get(analysis_id)
    if job is not None:
        return job
    if not _is_analysis_id(analysis_id):
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Vercel instances do not share memory. The only supported analysis is a
    # deterministic saved-real-data replay, so a valid ID can be reconstructed
    # safely when a request reaches a fresh instance.
    return await _complete_job(analysis_id)


@router.post("/analyses", response_model=AnalysisJob, status_code=201)
async def create_analysis(
    request: AnalysisCreateRequest | None = None,
) -> AnalysisJob:
    del request  # The validated body is intentionally empty for this narrow slice.
    analysis_id = await service.create_demo_job()
    return await _complete_job(analysis_id)


@router.get("/analyses/{analysis_id}", response_model=AnalysisJob)
async def get_analysis(analysis_id: str) -> AnalysisJob:
    return await _get_or_replay_job(analysis_id)


@router.post("/analyses/{analysis_id}/agent", response_model=AnalysisResult)
async def run_agent(analysis_id: str) -> AnalysisResult:
    job = await _get_or_replay_job(analysis_id)
    if job.result is None:
        raise HTTPException(status_code=409, detail=f"Analysis is {job.status.value}")
    job.result.agent = await agent_runner.run(job.result)
    await analysis_store.complete(analysis_id, job.result)
    return job.result


@router.post("/demo", response_model=AnalysisResult)
async def run_demo() -> AnalysisResult:
    """Run the stable Phoenix replay and include the agent trace in one demo call."""
    result = await service.run_demo()
    result.agent = await agent_runner.run(result)
    await analysis_store.complete(result.analysis_id, result)
    return result


@router.post("/analyze", response_model=AnalysisResult)
async def analyze_scenario(request: ScenarioAnalysisRequest) -> AnalysisResult:
    """Analyze a validated fictional operation against the pinned Phoenix replay."""
    result = await service.run_scenario(request)
    result.agent = await agent_runner.run(result)
    return result


@router.get("/demo/scenario")
async def demo_scenario() -> dict:
    site, crews, shift = service.load_demo_scenario()
    return {
        "site": site,
        "crews": crews,
        "shift": shift,
        "fictional_operation": True,
    }
