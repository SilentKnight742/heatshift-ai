import type { AnalysisResult, ScenarioPayload, ScheduleItem, Task } from "@/lib/api";

const polygon = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-112.08, 33.44], [-112.06, 33.44], [-112.06, 33.46], [-112.08, 33.46], [-112.08, 33.44],
      ]],
    },
  }],
};

export function scenarioFixture(): ScenarioPayload {
  const task: Task = {
    task_id: "task-1",
    name: "Heavy cargo loading",
    crew_id: "crew-1",
    location: { longitude: -112.07, latitude: 33.45 },
    duration_minutes: 60,
    workload: "heavy",
    scheduled_start: "2026-08-28T13:00:00-07:00",
    earliest_start: "2026-08-28T06:00:00-07:00",
    latest_finish: "2026-08-28T16:00:00-07:00",
    movable: true,
    dependencies: [],
    shaded: false,
  };
  return {
    site: {
      site_id: "desertline-yard",
      name: "DesertLine Logistics Yard",
      polygon,
      timezone: "America/Phoenix",
      surface_type: "paved logistics yard",
      shade_available: true,
      cooling_zone_coordinates: { longitude: -112.0718, latitude: 33.4504 },
      fictional: true,
    },
    crews: [{
      crew_id: "crew-1",
      name: "Charlie Crew",
      worker_count: 4,
      acclimatization_status: "acclimatized",
      ppe_level: "low",
      default_workload: "moderate",
    }],
    shift: {
      shift_id: "reference-shift",
      date: "2026-08-28",
      timezone: "America/Phoenix",
      shift_start: "2026-08-28T06:00:00-07:00",
      shift_end: "2026-08-28T16:00:00-07:00",
      tasks: [task],
    },
    environment_source: "phoenix_reference",
  };
}

function scheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    task_id: "task-1",
    task_name: "Heavy cargo loading",
    crew_id: "crew-1",
    crew_name: "Charlie Crew",
    worker_count: 4,
    workload: "heavy",
    start: "2026-08-28T13:00:00-07:00",
    end: "2026-08-28T14:00:00-07:00",
    movable: true,
    shaded: false,
    average_risk: 70,
    peak_risk: 74,
    peak_band: "high",
    exposed_worker_minutes: 240,
    risk_factors: [{ name: "apparent_temperature", points: 28, detail: "45°C apparent temperature" }],
    ...overrides,
  };
}

export function analysisFixture(): AnalysisResult {
  const scenario = scenarioFixture();
  return {
    analysis_id: "analysis-12345678",
    status: "completed",
    site: scenario.site,
    crews: scenario.crews,
    tasks: scenario.shift.tasks,
    heatmap_geojson: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { average_temperature: 41.44 }, geometry: { type: "Polygon", coordinates: [[[-112.08, 33.44], [-112.07, 33.44], [-112.07, 33.45], [-112.08, 33.45], [-112.08, 33.44]]] } },
        { type: "Feature", properties: { average_temperature: 41.54 }, geometry: { type: "Polygon", coordinates: [[[-112.07, 33.44], [-112.06, 33.44], [-112.06, 33.45], [-112.07, 33.45], [-112.07, 33.44]]] } },
      ],
    },
    observations: [
      { timestamp: "2026-08-28T06:00:00-07:00", latitude: 33.45, longitude: -112.07, apparent_temperature_c: 33, heat_index_c: 33, wet_bulb_temperature_c: 21, relative_humidity_percent: 55.7, solar_irradiance_ghi_wm2: 100, source: "FortyGuard", activity_id: "env-1" },
      { timestamp: "2026-08-28T15:00:00-07:00", latitude: 33.45, longitude: -112.07, apparent_temperature_c: 45.3, heat_index_c: 45, wet_bulb_temperature_c: 23.8, relative_humidity_percent: 14.9, solar_irradiance_ghi_wm2: 596, source: "FortyGuard", activity_id: "env-2" },
    ],
    baseline_schedule: [scheduleItem()],
    optimized_schedule: [scheduleItem({ start: "2026-08-28T06:00:00-07:00", end: "2026-08-28T07:00:00-07:00", average_risk: 28, peak_risk: 32, peak_band: "low", exposed_worker_minutes: 0 })],
    movements: [{ task_id: "task-1", task_name: "Heavy cargo loading", from_start: "2026-08-28T13:00:00-07:00", to_start: "2026-08-28T06:00:00-07:00", minutes_moved: 420, reason: "Moves heavy work into the coolest valid crew window." }],
    metrics: {
      peak_temperature_c: 41.5,
      peak_apparent_temperature_c: 45.3,
      maximum_screening_score: 74,
      highest_risk_task: "Heavy cargo loading",
      baseline_exposed_worker_minutes: 1230,
      optimized_exposed_worker_minutes: 270,
      exposure_reduction_percent: 78,
      schedule_disruption_minutes: 420,
      productivity_retained_percent: 100,
      tasks_moved: 1,
    },
    recommendations: [{ priority: "high", title: "Move heavy work", detail: "Move the task earlier.", evidence: "Preserves duration and constraints." }],
    worker_alerts: [{ alert_id: "alert-1", severity: "high", headline: "HIGH HEAT RISK", task_name: "Heavy cargo loading", crew_name: "Charlie Crew", message: "Screening score 74/100.", next_action: "Move to the cooling zone.", hydration_check_due: true }],
    data_provenance: { source_label: "FortyGuard cached real response", captured_at: "2026-08-28", heatmap_activity_id: "heatmap-activity-123456", environmental_activity_id: "environment-activity-654321", heatmap_timestamp: "2026-08-28T15:00:00-07:00", environmental_time_range: "06:00–16:00", mode: "cached" },
    policy_version: "1.0.0",
    limitations: ["Screening-level decision support only."],
    agent: {
      mode: "deterministic_fallback",
      explanation: "Move the heavy task to the cooler morning window and retain manager review for residual alerts.",
      tool_trace: [
        { sequence: 1, tool: "load_evidence", arguments: {}, latency_ms: 2, success: true, summary: "Loaded pinned evidence." },
        { sequence: 2, tool: "validate_plan", arguments: {}, latency_ms: 1, success: true, summary: "Validated constraints." },
      ],
      evidence_references: ["heatmap-activity-123456"],
      alerts: [],
    },
  };
}
