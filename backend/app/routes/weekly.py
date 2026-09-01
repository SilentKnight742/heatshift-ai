from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ..clients.fortyguard import FortyGuardError

from ..models.weekly import (
    QuestionRequest,
    QuestionResponse,
    ProvisionRequest,
    ProvisionStatus,
    SiteWorkspace,
    WeeklyAnalysis,
    WeeklyCrew,
    WeeklyCrewCreate,
    WeeklyJob,
    WeeklyJobCreate,
    WeeklySite,
    WeeklySiteCreate,
    WorkingPlanPatch,
    WorkspaceState,
)
from ..services.auth import WorkspacePrincipal, require_workspace
from ..services.weekly_ai import answer_question
from ..services.weekly_store import weekly_state_options, weekly_store
from ..services.provisioning import ProvisioningError, provisioning_service


router = APIRouter(prefix="/api", tags=["weekly operations"])


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail=str(exc).strip("'"))
    return HTTPException(status_code=409, detail=str(exc))


@router.get("/states")
async def get_states() -> list[dict[str, str]]:
    return weekly_state_options


@router.get("/workspace", response_model=WorkspaceState)
async def get_workspace(principal: WorkspacePrincipal = Depends(require_workspace)) -> WorkspaceState:
    return (await weekly_store.workspace(principal.user_id)).state


@router.patch("/workspace", response_model=WorkspaceState)
async def patch_workspace(
    patch: dict[str, Any], principal: WorkspacePrincipal = Depends(require_workspace)
) -> WorkspaceState:
    try:
        return await weekly_store.patch_workspace(principal.user_id, patch)
    except ValueError as exc:
        raise _http_error(exc) from exc


@router.get("/states/{state_code}/sites", response_model=list[WeeklySite])
async def get_state_sites(
    state_code: str, principal: WorkspacePrincipal = Depends(require_workspace)
) -> list[WeeklySite]:
    return await weekly_store.list_sites(principal.user_id, state_code)


@router.post("/sites", response_model=WeeklySite, status_code=status.HTTP_201_CREATED)
async def create_site(
    payload: WeeklySiteCreate, principal: WorkspacePrincipal = Depends(require_workspace)
) -> WeeklySite:
    try:
        return await weekly_store.create_site(principal.user_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/sites/{site_id}", response_model=SiteWorkspace)
async def get_site(
    site_id: str, principal: WorkspacePrincipal = Depends(require_workspace)
) -> SiteWorkspace:
    try:
        return await weekly_store.site_workspace(principal.user_id, site_id)
    except KeyError as exc:
        raise _http_error(exc) from exc


@router.post("/sites/{site_id}/provision/advance", response_model=ProvisionStatus)
async def advance_provisioning(
    site_id: str,
    payload: ProvisionRequest,
    request: Request,
    principal: WorkspacePrincipal = Depends(require_workspace),
) -> ProvisionStatus:
    try:
        return await provisioning_service.advance(
            principal.user_id, site_id, payload, request.client.host if request.client else None
        )
    except KeyError as exc:
        raise _http_error(exc) from exc
    except (ProvisioningError, FortyGuardError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/sites/{site_id}/provision", response_model=ProvisionStatus)
async def get_provisioning(
    site_id: str, principal: WorkspacePrincipal = Depends(require_workspace)
) -> ProvisionStatus:
    try:
        return await provisioning_service.get(principal.user_id, site_id)
    except KeyError as exc:
        raise _http_error(exc) from exc


@router.patch("/sites/{site_id}", response_model=WeeklySite)
async def patch_site(
    site_id: str, patch: dict[str, Any], principal: WorkspacePrincipal = Depends(require_workspace)
) -> WeeklySite:
    try:
        return await weekly_store.patch_site(principal.user_id, site_id, patch)
    except (KeyError, ValueError) as exc:
        raise _http_error(exc) from exc


@router.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(
    site_id: str, principal: WorkspacePrincipal = Depends(require_workspace)
) -> Response:
    try:
        await weekly_store.delete_site(principal.user_id, site_id)
    except (KeyError, ValueError) as exc:
        raise _http_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sites/{site_id}/crews", response_model=list[WeeklyCrew])
async def get_crews(site_id: str, principal: WorkspacePrincipal = Depends(require_workspace)):
    return (await get_site(site_id, principal)).crews


@router.post("/sites/{site_id}/crews", response_model=WeeklyCrew, status_code=status.HTTP_201_CREATED)
async def create_crew(site_id: str, payload: WeeklyCrewCreate, principal: WorkspacePrincipal = Depends(require_workspace)):
    try:
        return await weekly_store.create_crew(principal.user_id, site_id, payload)
    except (KeyError, ValueError) as exc:
        raise _http_error(exc) from exc


@router.patch("/sites/{site_id}/crews/{crew_id}", response_model=WeeklyCrew)
async def patch_crew(site_id: str, crew_id: str, patch: dict[str, Any], principal: WorkspacePrincipal = Depends(require_workspace)):
    try:
        return await weekly_store.patch_crew(principal.user_id, site_id, crew_id, patch)
    except (KeyError, ValueError) as exc:
        raise _http_error(exc) from exc


@router.delete("/sites/{site_id}/crews/{crew_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_crew(site_id: str, crew_id: str, principal: WorkspacePrincipal = Depends(require_workspace)) -> Response:
    try:
        await weekly_store.delete_crew(principal.user_id, site_id, crew_id)
    except (KeyError, ValueError) as exc:
        raise _http_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sites/{site_id}/jobs", response_model=list[WeeklyJob])
async def get_jobs(site_id: str, principal: WorkspacePrincipal = Depends(require_workspace)):
    return (await get_site(site_id, principal)).jobs


@router.post("/sites/{site_id}/jobs", response_model=WeeklyJob, status_code=status.HTTP_201_CREATED)
async def create_job(site_id: str, payload: WeeklyJobCreate, principal: WorkspacePrincipal = Depends(require_workspace)):
    try:
        return await weekly_store.create_job(principal.user_id, site_id, payload)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/sites/{site_id}/jobs/{job_id}", response_model=WeeklyJob)
async def patch_job(site_id: str, job_id: str, patch: dict[str, Any], principal: WorkspacePrincipal = Depends(require_workspace)):
    try:
        return await weekly_store.patch_job(principal.user_id, site_id, job_id, patch)
    except (KeyError, ValueError) as exc:
        raise _http_error(exc) from exc


@router.delete("/sites/{site_id}/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(site_id: str, job_id: str, principal: WorkspacePrincipal = Depends(require_workspace)) -> Response:
    try:
        await weekly_store.delete_job(principal.user_id, site_id, job_id)
    except (KeyError, ValueError) as exc:
        raise _http_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sites/{site_id}/plans/optimize", response_model=WeeklyAnalysis)
async def optimize_plan(site_id: str, principal: WorkspacePrincipal = Depends(require_workspace)) -> WeeklyAnalysis:
    try:
        return await weekly_store.optimize(principal.user_id, site_id)
    except (KeyError, ValueError) as exc:
        raise _http_error(exc) from exc


@router.post("/sites/{site_id}/plans/evaluate", response_model=WeeklyAnalysis)
async def evaluate_plan(site_id: str, payload: WorkingPlanPatch, principal: WorkspacePrincipal = Depends(require_workspace)) -> WeeklyAnalysis:
    try:
        return await weekly_store.patch_working_plan(principal.user_id, site_id, payload)
    except (KeyError, ValueError) as exc:
        raise _http_error(exc) from exc


@router.patch("/sites/{site_id}/plans/working", response_model=WeeklyAnalysis)
async def patch_working_plan(site_id: str, payload: WorkingPlanPatch, principal: WorkspacePrincipal = Depends(require_workspace)) -> WeeklyAnalysis:
    return await evaluate_plan(site_id, payload, principal)


@router.post("/analyses/{analysis_id}/questions", response_model=QuestionResponse)
async def ask_question(
    analysis_id: str,
    payload: QuestionRequest,
    principal: WorkspacePrincipal = Depends(require_workspace),
) -> QuestionResponse:
    workspace = await weekly_store.workspace(principal.user_id)
    analysis = next(
        (record.analysis for record in workspace.sites.values() if record.analysis and record.analysis.analysis_id == analysis_id),
        None,
    )
    if analysis is None:
        raise HTTPException(status_code=404, detail="analysis not found in this workspace")
    return await answer_question(workspace, payload.question, payload.context, analysis)
