from __future__ import annotations

from fastapi import APIRouter

from ..models.validation import HeatShieldValidationResponse
from ..services.validation_service import heatshield_validation


router = APIRouter(prefix="/api/validation", tags=["validation"])


@router.get("/heatshield", response_model=HeatShieldValidationResponse)
async def get_heatshield_validation() -> HeatShieldValidationResponse:
    """Return the reproducible empirical benchmark for frontend evidence views."""

    return heatshield_validation()
