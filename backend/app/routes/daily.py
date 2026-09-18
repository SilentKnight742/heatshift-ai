from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from ..models.daily import DailyAnalysis, DailySite, DailySiteCreate, DailyWorkspace, SimulationRequest
from ..services.auth import WorkspacePrincipal, require_workspace
from ..services.daily_store import daily_state_options, daily_store
from ..services.provider_status import provider_status_service


router = APIRouter(prefix="/api/daily", tags=["daily operations"])


def _error(exc: Exception, code: int = 409) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail=str(exc).strip("'"))
    return HTTPException(status_code=code, detail=str(exc))


@router.get("/states")
async def states() -> list[dict[str, str]]:
    return daily_state_options


@router.get("/sites", response_model=list[DailySite])
async def sites(principal: WorkspacePrincipal = Depends(require_workspace)) -> list[DailySite]:
    return await daily_store.list_sites(principal.user_id)


@router.get("/provider-status")
async def provider_status(
    refresh: bool = Query(False),
    _principal: WorkspacePrincipal = Depends(require_workspace),
) -> dict:
    return await provider_status_service.check(force=refresh)


@router.post("/reset", response_model=list[DailySite])
async def reset_workspace(
    principal: WorkspacePrincipal = Depends(require_workspace),
) -> list[DailySite]:
    return await daily_store.reset(principal.user_id)


@router.get("/states/{state_code}/sites", response_model=list[DailySite])
async def state_sites(
    state_code: str, principal: WorkspacePrincipal = Depends(require_workspace)
) -> list[DailySite]:
    return await daily_store.list_sites(principal.user_id, state_code)


@router.post("/sites", response_model=DailySite, status_code=status.HTTP_201_CREATED)
async def create_site(
    payload: DailySiteCreate, principal: WorkspacePrincipal = Depends(require_workspace)
) -> DailySite:
    try:
        return await daily_store.create_site(principal.user_id, payload)
    except ValueError as exc:
        raise _error(exc, 422) from exc


@router.get("/sites/{site_id}", response_model=DailyWorkspace)
async def site(
    site_id: str, principal: WorkspacePrincipal = Depends(require_workspace)
) -> DailyWorkspace:
    try:
        return await daily_store.site(principal.user_id, site_id)
    except KeyError as exc:
        raise _error(exc) from exc


@router.post("/sites/{site_id}/simulation", response_model=DailyWorkspace)
async def generate_simulation(
    site_id: str,
    payload: SimulationRequest,
    principal: WorkspacePrincipal = Depends(require_workspace),
) -> DailyWorkspace:
    try:
        return await daily_store.generate(principal.user_id, site_id, payload)
    except (KeyError, ValueError) as exc:
        raise _error(exc) from exc


@router.post("/sites/{site_id}/analysis", response_model=DailyAnalysis)
async def run_analysis(
    site_id: str, principal: WorkspacePrincipal = Depends(require_workspace)
) -> DailyAnalysis:
    try:
        return await daily_store.analyze(principal.user_id, site_id)
    except (KeyError, ValueError) as exc:
        raise _error(exc) from exc


@router.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(
    site_id: str, principal: WorkspacePrincipal = Depends(require_workspace)
) -> Response:
    try:
        await daily_store.delete(principal.user_id, site_id)
    except (KeyError, ValueError) as exc:
        raise _error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
