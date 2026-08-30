from __future__ import annotations

import asyncio

import pytest

from app.clients.fortyguard import FortyGuardClient


def test_cached_real_fixture_normalizes() -> None:
    bundle = asyncio.run(FortyGuardClient().get_heat_forecast())
    assert len(bundle.heatmap_geojson["features"]) == 198
    assert len(bundle.observations) == 11
    assert bundle.temperature_stats["maximum"] == pytest.approx(41.533)
    assert bundle.observations[0].wet_bulb_temperature_c == pytest.approx(23.1)
    assert bundle.provenance.mode == "cached"
    assert bundle.provenance.heatmap_activity_id == "81e55f4d-b51b-4dcc-bd4f-ab4e6c527002"


def test_missing_sentinels_are_normalized() -> None:
    client = FortyGuardClient()
    assert client._normalize_missing(None) is None
    assert client._normalize_missing(-999) is None
    assert client._normalize_missing(0) == 0.0


def test_invalid_polygon_is_rejected() -> None:
    with pytest.raises(ValueError, match="closed ring"):
        FortyGuardClient._validate_polygon(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-112.0, 33.0], [-111.9, 33.0], [-111.9, 33.1]]],
                        }
                    }
                ],
            }
        )

