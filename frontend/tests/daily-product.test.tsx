import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DailyConsole from "@/components/DailyConsole";
import { heatColorForCell, heatColorForTemperature, pointInGeometry, temperatureForCell, temperatureScaleForEvidence } from "@/components/DailyMap";
import ProductHeader from "@/components/ProductHeader";
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
    window.localStorage.clear();
  });

  it("reconstructs an hourly cell value and associates points with the cell", () => {
    expect(temperatureForCell(evidence, "cell-1", 15)).toBe(43);
    expect(pointInGeometry(job.location.longitude, job.location.latitude, evidence.heat_cells[0].geometry)).toBe(true);
    expect(pointInGeometry(-111, 34, evidence.heat_cells[0].geometry)).toBe(false);
  });

  it("derives one fixed continuous scale from all available state hours", () => {
    const stateEvidence = { ...evidence, conditions: [{ ...evidence.conditions[0], timestamp: "2024-07-18T06:00:00-07:00", apparent_temperature_c: 31.2 }, evidence.conditions[0]] };
    const scale = temperatureScaleForEvidence([stateEvidence]);
    expect(scale).toEqual({ minimum: 31, maximum: 43 });
    expect(heatColorForTemperature(-20, scale!)).toBe(heatColorForTemperature(31, scale!));
    expect(heatColorForTemperature(80, scale!)).toBe(heatColorForTemperature(43, scale!));
    expect(heatColorForTemperature(35, scale!)).not.toBe(heatColorForTemperature(36, scale!));
    expect(new Set([31, 33, 35, 37, 39, 41, 43].map((value) => heatColorForTemperature(value, scale!))).size).toBe(7);
    expect(heatColorForCell(38, scale!, 0)).not.toBe(heatColorForCell(38, scale!, 1));
    expect(heatColorForCell(38, scale!, .5)).toBe(heatColorForTemperature(38, scale!));
  });

  it("starts with the state map, then exposes map analytics and sanitized briefing content", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      const body = url.includes("/api/daily/provider-status") ? { state: "available", live_available: true, fallback_active: false, credits_remaining: 500000, checked_at: "2026-09-18T00:00:00Z", message: "FortyGuard responded." } : url.endsWith("/api/daily/states") ? [{ code: "AZ", name: "Arizona" }] : url.endsWith("/api/daily/sites") ? [site] : workspace;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const { container } = render(<DailyConsole />);
    expect(await screen.findByText("Arizona operations")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Test yard Analysis ready/ }));
    await waitFor(() => expect(screen.getByText("Cached FortyGuard evidence")).toBeInTheDocument());
    expect(screen.getByText("Generate a new simulation")).toBeInTheDocument();
    expect(screen.getByText("Run HeatShift analysis")).toBeInTheDocument();
    expect(screen.queryByText("Three-step flow")).not.toBeInTheDocument();
    expect(screen.queryByText("Real conditions and fictional work stay separate.")).not.toBeInTheDocument();
    expect(screen.queryByText(/week starts/i)).not.toBeInTheDocument();
    expect(screen.queryByText("One day, before and after")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Create site" }));
    const createDialog = screen.getByRole("dialog", { name: "Create daily operation site" });
    expect(createDialog).toHaveClass("create-site-backdrop");
    expect(screen.getByLabelText("Site name")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Create daily operation site" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Operational briefing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Analysis results" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exposure reduction 100.0%/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
    expect(screen.getAllByText("Material transfer").some((element) => element.tagName === "STRONG")).toBe(true);
    expect(container.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse AI briefing" }));
    expect(screen.queryByRole("heading", { name: "Decision" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand AI briefing" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand AI briefing" }));
    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
    const exposureCard = screen.getByRole("button", { name: /Exposure reduction 100.0%/ });
    fireEvent.click(exposureCard);
    expect(screen.getByRole("button", { name: "Collapse analytics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Exposure reduction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse AI briefing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
    expect(exposureCard).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(exposureCard);
    expect(screen.queryByRole("heading", { name: "Exposure reduction" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand analytics" })).toBeInTheDocument();
    expect(exposureCard).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Collapse setup panel" }));
    expect(container.querySelector(".map-console-shell")).toHaveClass("sidebar-collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Expand setup panel" }));
    expect(container.querySelector(".map-console-shell")).not.toHaveClass("sidebar-collapsed");
    fireEvent.click(screen.getByRole("button", { name: /Operation & method/ }));
    expect(screen.getByRole("dialog", { name: "Test yard operation and methodology" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "See the operation HeatShift received, what changed, and why." })).toBeInTheDocument();
    expect(screen.getByText("Job-level comparison")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A constrained search, not an AI guess." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back to map/ }));
    expect(screen.queryByRole("dialog", { name: "Test yard operation and methodology" })).not.toBeInTheDocument();
    window.dispatchEvent(new Event("heatshift:open-guide"));
    expect(await screen.findByRole("dialog", { name: "HeatShift console guide" })).toBeInTheDocument();
    expect(screen.getByText("Built-in sites use cached FortyGuard evidence. New-site weather and all generated operations are clearly labeled.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close console guide" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/daily/sites/site-test"), expect.anything()));
  });

  it("keeps fallback in the header and exits it only after a successful retry", async () => {
    let providerRetries = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/daily/provider-status")) {
        if (url.includes("refresh=true")) providerRetries += 1;
        const available = providerRetries >= 2;
        return new Response(JSON.stringify(available
          ? { state: "available", live_available: true, fallback_active: false, credits_remaining: 500000, checked_at: "2026-09-18T00:02:00Z", message: "FortyGuard responded." }
          : { state: "provider_unavailable", live_available: false, fallback_active: true, credits_remaining: null, checked_at: "2026-09-18T00:00:00Z", message: "A secure connection to FortyGuard could not be established. Cached and simulated evidence remain available." }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = url.endsWith("/api/daily/states") ? [{ code: "AZ", name: "Arizona" }] : url.endsWith("/api/daily/sites") ? [site] : workspace;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
    render(<><ProductHeader consoleMode /><DailyConsole /></>);
    const provider = await screen.findByRole("status");
    await waitFor(() => expect(provider).toHaveTextContent("Simulated run"));
    expect(provider).toHaveTextContent("FortyGuard could not be reached securely");
    expect(screen.queryByRole("dialog", { name: "FortyGuard fallback active" })).not.toBeInTheDocument();
    expect(await screen.findByText("Arizona operations")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(provider).toHaveTextContent("Simulated run"));
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(provider).toHaveTextContent("FortyGuard live"));
    expect(provider).toHaveTextContent("The data provider responded successfully.");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
