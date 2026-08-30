from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, ConfigDict

from ..agent.runner import AgentRunner
from ..models.analysis import AnalysisJob, AnalysisResult
from ..models.crew import Crew
from ..models.site import Site
from ..models.task import Task
from ..services.analysis_service import AnalysisService
from ..services.cache import analysis_store


router = APIRouter(prefix="/api", tags=["analysis"])
service = AnalysisService(store=analysis_store)
agent_runner = AgentRunner()


class AnalysisCreateRequest(BaseModel):
    """Validated single-site request; omitted fields select the bundled demo scenario."""

    model_config = ConfigDict(extra="forbid")
    site: Site | None = None
    crews: list[Crew] | None = None
    tasks: list[Task] | None = None
    analysis_time: datetime | None = None


async def _run_job(analysis_id: str) -> None:
    result = await service.run_demo(analysis_id)
    result.agent = await agent_runner.run(result)
    await analysis_store.complete(analysis_id, result)


@router.post("/analyses", response_model=AnalysisJob, status_code=202)
async def create_analysis(
    background_tasks: BackgroundTasks,
    request: AnalysisCreateRequest | None = None,
) -> AnalysisJob:
    if request and request.site and request.site.site_id != "desertline-yard":
        raise HTTPException(status_code=422, detail="This hackathon slice supports DesertLine Yard only")
    analysis_id = await service.create_demo_job()
    background_tasks.add_task(_run_job, analysis_id)
    job = await analysis_store.get(analysis_id)
    assert job is not None
    return job


@router.get("/analyses/{analysis_id}", response_model=AnalysisJob)
async def get_analysis(analysis_id: str) -> AnalysisJob:
    job = await analysis_store.get(analysis_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return job


@router.post("/analyses/{analysis_id}/agent", response_model=AnalysisResult)
async def run_agent(analysis_id: str) -> AnalysisResult:
    job = await analysis_store.get(analysis_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
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


@router.get("/demo/scenario")
async def demo_scenario() -> dict:
    site, crews, shift = service.load_demo_scenario()
    return {
        "site": site,
        "crews": crews,
        "shift": shift,
        "fictional_operation": True,
    }

