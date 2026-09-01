from scripts.seed_supabase_curated_portfolio import build_seed_payloads


def test_supabase_curated_seed_has_five_complete_immutable_weeks():
    payloads = build_seed_payloads()
    assert len(payloads) == 5
    assert {site["state_code"] for site, _ in payloads} == {"AZ", "TX", "FL", "NV", "NY"}
    assert all(site["curated"] and site["fictional_operation"] for site, _ in payloads)
    assert all(len(days) == 7 for _, days in payloads)
    assert all(day["immutable"] for _, days in payloads for day in days)


def test_supabase_curated_seed_reconstructs_every_hour_and_preserves_formula():
    _, days = build_seed_payloads()[0]
    first = days[0]
    derived = first["derived_hourly_cells"]
    assert len(derived["hours"]) == 24
    assert len(derived["hours"][0]["cells"]) == len(first["heatmap"]["cells"])
    assert "15:00 cell temperature" in derived["formula"]
    assert all(
        cell["source"] == "HeatShift-derived interpolation"
        for hour in derived["hours"]
        for cell in hour["cells"]
    )
