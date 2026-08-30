from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes.analyses import router as analyses_router
from .routes.health import router as health_router
from .routes.validation import router as validation_router


app = FastAPI(
    title="HeatShift AI",
    version="1.0.0",
    description="Screening-level heat-risk shift optimization backed by real FortyGuard data.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["content-type"],
)
app.include_router(health_router)
app.include_router(analyses_router)
app.include_router(validation_router)


@app.get("/")
async def root() -> dict:
    return {
        "name": "HeatShift AI API",
        "docs": "/docs",
        "health": "/health",
        "demo": "POST /api/demo",
        "empirical_validation": "/api/validation/heatshield",
    }
