from __future__ import annotations

import asyncio
import hashlib
import json

import httpx

from app.main import app
from app.services.validation_service import (
    DATA_PATH,
    PROVENANCE_PATH,
    heatshield_validation,
)


async def request(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


def test_heatshield_slice_integrity_and_provenance() -> None:
    provenance = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
    digest = hashlib.sha256(DATA_PATH.read_bytes()).hexdigest()

    assert digest == provenance["derived_slice"]["sha256"]
    assert provenance["derived_slice"]["records"] == 566
    assert provenance["derived_slice"]["pseudonymous_participants"] == 32
    assert provenance["dataset"]["license"]["identifier"] == "CC BY 4.0"
    assert provenance["source_file"]["md5"] == (
        "e36962603afbdbd6e9856936aacab62f"
    )


def test_heatshield_metrics_are_reproducible_and_unfitted() -> None:
    heatshield_validation.cache_clear()
    result = heatshield_validation()

    assert result.dataset.records == 566
    assert result.dataset.pseudonymous_participants == 32
    assert result.benchmark_profile.policy_version == "1.0.0"
    assert result.benchmark_profile.fitted_to_dataset is False
    assert result.metrics.score_vs_measured_pwc_loss.pearson_r == 0.7744
    assert result.metrics.score_vs_measured_pwc_loss.spearman_rho == 0.7718
    assert result.metrics.environmental_points_vs_measured_pwc_loss.spearman_rho == (
        0.8133
    )
    assert result.metrics.mean_loss_difference_percentage_points == 36.45
    assert result.metrics.below_high_risk_threshold.records == 248
    assert result.metrics.at_or_above_high_risk_threshold.records == 318
    assert sum(band.records for band in result.metrics.bands) == 566
    assert [band.band for band in result.metrics.bands] == [
        "moderate",
        "high",
        "critical",
    ]


def test_heatshield_validation_api_contract() -> None:
    response = asyncio.run(request("/api/validation/heatshield"))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["benchmark_type"] == "descriptive_empirical_alignment"
    assert body["dataset"]["records"] == 566
    assert body["metrics"]["mean_loss_difference_percentage_points"] == 36.45
    assert body["benchmark_profile"]["fitted_to_dataset"] is False
    assert len(body["limitations"]) == 5


def test_health_and_root_advertise_empirical_validation() -> None:
    health = asyncio.run(request("/health"))
    root = asyncio.run(request("/"))

    assert health.json()["empirical_validation"]["available"] is True
    assert health.json()["empirical_validation"]["requires_external_api"] is False
    assert root.json()["empirical_validation"] == "/api/validation/heatshield"
