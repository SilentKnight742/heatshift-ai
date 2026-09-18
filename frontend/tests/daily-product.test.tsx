import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DailyConsole from "@/components/DailyConsole";
import { pointInGeometry, temperatureForCell } from "@/components/DailyMap";
import type { DailyAnalysis, DailyEvidence, DailySite, DailyWorkspace } from "@/lib/api";

const geometry = { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: {}, geometry: { type: "Polygon", coordinates: [[[-112.1, 33.4], [-112, 33.4], [-112, 33.5], [-112.1, 33.5], [-112.1, 33.4]]] } }] };
const site: DailySite = {
  site_id: "site-test", owner_id: null, name: "Test yard", state_code: "AZ", site_type: "yard",
  operation_date: "2024-07-18", geometry, centroid: { longitude: -112.05, latitude: 33.45 }, timezone: "America/Phoenix", curated: true,
  workflow_stage: "analyzed", evidence_kind: "fortyguard_cached", source_label: "Cached FortyGuard day", thermal_burden: 38,
};
const evidence: DailyEvidence = {
  date: "2024-07-18", heatmap_activity_id: "heat-1", environmental_activity_id: "env-1", integrity_sha256: "abc", satellite_context: {},
  conditions: [{ timestamp: "2024-07-18T15:00:00-07:00", temperature_c: 40, apparent_temperature_c: 43, wet_bulb_temperature_c: 25, relative_humidity_percent: 30, solar_irradiance_ghi_wm2: 700, source: "FortyGuard", activity_id: "env-1" }],
  heat_cells: [{ cell_id: "cell-1", geometry: geometry.features[0].geometry, temperature_c_1500: 41, apparent_temperature_c: 43, source: "FortyGuard" }],
};
const crew = { crew_id: "crew-1", site_id: "site-test", name: "Field crew", worker_count: 10, acclimatization_status: "acclimatized" as const, ppe_level: "medium" as const, default_workload: "heavy" as const };
const job = { job_id: "job-1", site_id: "site-test", name: "Material transfer · Zone A", location: site.centroid, duration_minutes: 60, workload: "heavy" as const, original_start: "2024-07-18T13:00:00-07:00", earliest_start: "2024-07-18T06:00:00-07:00", latest_finish: "2024-07-18T20:00:00-07:00", assigned_crew_id: "crew-1", eligible_crew_ids: ["crew-1"], movable: true, shaded: false };
const metrics = { original_exposure_worker_minutes: 600, proposed_exposure_worker_minutes: 0, high_risk_hours_avoided: 10, risk_reduction_percent: 100, tasks_rescheduled: 1, fixed_tasks_preserved: 0, residual_alerts: 0, productive_task_time_retained_percent: 100, constraint_valid: true, site_thermal_burden_degree_hours: 38, original_crew_exposure_load: 8, proposed_crew_exposure_load: 4, highest_loaded_crew_id: "crew-1", crew_load_spread: 0, disruption: { total_minutes_shifted: 360, crew_reassignments: 0, hard_constraint_violations: 0 } };
const analysis: DailyAnalysis = {
  analysis_id: "analysis-1", site_id: "site-test", operation_date: "2024-07-18", policy_version: "test",
  original: [{ job_id: "job-1", crew_id: "crew-1", start: job.original_start, end: "2024-07-18T14:00:00-07:00", source: "original", screening_score: 80 }],
  heatshift: [{ job_id: "job-1", crew_id: "crew-1", start: "2024-07-18T07:00:00-07:00", end: "2024-07-18T08:00:00-07:00", source: "heatshift", screening_score: 40 }],
  metrics,
  explanations: { risk_reduction: { metric: "High-risk exposure reduction", definition: "Change above threshold.", formula: "(original − proposed) ÷ original", inputs: {}, source: "HeatShift", comparison: "600 → 0 worker-minutes.", limitations: ["Threshold-dependent."] } },
  recommendations: [], limitations: ["Screening only."],
  briefing_markdown: "## Decision\n\nMove **Material transfer** earlier.\n\n<script>bad()</script>",
};
const workspace: DailyWorkspace = {
  site, evidence, crews: [crew], jobs: [job], simulation: { seed: 42, generation_mode: "deterministic_stochastic", crew_count: 1, job_count: 1, worker_count: 10, fixed_job_count: 0, movable_job_count: 1 }, analysis,
};

describe("daily operations product", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  });

  it("reconstructs an hourly cell value and associates points with the cell", () => {
    expect(temperatureForCell(evidence, "cell-1", 15)).toBe(43);
    expect(pointInGeometry(job.location.longitude, job.location.latitude, evidence.heat_cells[0].geometry)).toBe(true);
    expect(pointInGeometry(-111, 34, evidence.heat_cells[0].geometry)).toBe(false);
  });

  it("starts with the state map, then exposes map analytics and sanitized briefing content", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      const body = url.endsWith("/api/daily/states") ? [{ code: "AZ", name: "Arizona" }] : url.endsWith("/api/daily/sites") ? [site] : workspace;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const { container } = render(<DailyConsole />);
    expect(await screen.findByText("Arizona operations")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Test yard" }));
    await waitFor(() => expect(screen.getByText("Cached FortyGuard evidence")).toBeInTheDocument());
    expect(screen.getByText("Generate a new simulation")).toBeInTheDocument();
    expect(screen.getByText("Run HeatShift analysis")).toBeInTheDocument();
    expect(screen.queryByText(/week starts/i)).not.toBeInTheDocument();
    expect(screen.queryByText("One day, before and after")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exposure reduction 100.0%/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /AI briefing Read/ }));
    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
    expect(screen.getAllByText("Material transfer").some((element) => element.tagName === "STRONG")).toBe(true);
    expect(container.querySelector("script")).toBeNull();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/daily/sites/site-test"), expect.anything()));
  });
});
