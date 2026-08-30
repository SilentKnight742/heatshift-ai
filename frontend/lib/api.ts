export type RiskBand = "low" | "moderate" | "high" | "critical";

export interface GeoPoint {
  longitude: number;
  latitude: number;
}

export interface Site {
  site_id: string;
  name: string;
  polygon: Record<string, unknown>;
  timezone: string;
  surface_type: string;
  shade_available: boolean;
  cooling_zone_coordinates: GeoPoint;
  fictional: boolean;
}

export interface Crew {
  crew_id: string;
  name: string;
  worker_count: number;
  acclimatization_status: string;
  ppe_level: string;
  default_workload: string;
}

export interface Task {
  task_id: string;
  name: string;
  crew_id: string;
  location: GeoPoint;
  duration_minutes: number;
  workload: string;
  scheduled_start: string;
  earliest_start: string;
  latest_finish: string;
  movable: boolean;
  dependencies: string[];
  shaded: boolean;
}

export interface ShiftPlan {
  shift_id: string;
  date: string;
  timezone: string;
  shift_start: string;
  shift_end: string;
  tasks: Task[];
}

export interface ScenarioPayload {
  site: Site;
  crews: Crew[];
  shift: ShiftPlan;
  environment_source: "phoenix_reference";
}

export interface DemoScenario {
  site: Site;
  crews: Crew[];
  shift: ShiftPlan;
  fictional_operation: boolean;
}

export interface Observation {
  timestamp: string;
  latitude: number;
  longitude: number;
  apparent_temperature_c: number | null;
  heat_index_c: number | null;
  wet_bulb_temperature_c: number | null;
  relative_humidity_percent: number | null;
  solar_irradiance_ghi_wm2: number | null;
  source: string;
  activity_id: string;
}

export interface RiskFactor {
  name: string;
  points: number;
  detail: string;
}

export interface ScheduleItem {
  task_id: string;
  task_name: string;
  crew_id: string;
  crew_name: string;
  worker_count: number;
  workload: string;
  start: string;
  end: string;
  movable: boolean;
  shaded: boolean;
  average_risk: number;
  peak_risk: number;
  peak_band: RiskBand;
  exposed_worker_minutes: number;
  risk_factors: RiskFactor[];
}

export interface Movement {
  task_id: string;
  task_name: string;
  from_start: string;
  to_start: string;
  minutes_moved: number;
  reason: string;
}

export interface Metrics {
  peak_temperature_c: number;
  peak_apparent_temperature_c: number;
  maximum_screening_score: number;
  highest_risk_task: string;
  baseline_exposed_worker_minutes: number;
  optimized_exposed_worker_minutes: number;
  exposure_reduction_percent: number;
  schedule_disruption_minutes: number;
  productivity_retained_percent: number;
  tasks_moved: number;
}

export interface Recommendation {
  priority: string;
  title: string;
  detail: string;
  evidence: string;
}

export interface WorkerAlert {
  alert_id: string;
  severity: RiskBand;
  headline: string;
  task_name: string;
  crew_name: string;
  message: string;
  next_action: string;
  hydration_check_due: boolean;
}

export interface ToolTrace {
  sequence: number;
  tool: string;
  arguments: Record<string, unknown>;
  latency_ms: number;
  success: boolean;
  summary: string;
}

export interface AnalysisResult {
  analysis_id: string;
  status: string;
  site: Site;
  crews: Crew[];
  tasks: Task[];
  heatmap_geojson: Record<string, unknown>;
  observations: Observation[];
  baseline_schedule: ScheduleItem[];
  optimized_schedule: ScheduleItem[];
  movements: Movement[];
  metrics: Metrics;
  recommendations: Recommendation[];
  worker_alerts: WorkerAlert[];
  data_provenance: {
    source_label: string;
    captured_at: string;
    heatmap_activity_id: string;
    environmental_activity_id: string;
    heatmap_timestamp: string;
    environmental_time_range: string;
    mode: string;
  };
  policy_version: string;
  limitations: string[];
  agent: {
    mode: string;
    explanation: string;
    tool_trace: ToolTrace[];
    evidence_references: string[];
    alerts: WorkerAlert[];
  } | null;
}

export interface CorrelationMetric {
  pearson_r: number;
  spearman_rho: number;
}

export interface HeatshieldValidation {
  status: string;
  benchmark_type: string;
  dataset: {
    title: string;
    doi: string;
    landing_page: string;
    publisher: string;
    published_date: string;
    funding: string;
    license: {
      name: string;
      identifier: string;
      url: string;
    };
    records: number;
    pseudonymous_participants: number;
    source_file_id: number;
    source_file_md5: string;
    derived_csv_sha256: string;
  };
  benchmark_profile: {
    name: string;
    policy_version: string;
    workload: string;
    workload_points: number;
    acclimatization: string;
    acclimatization_points: number;
    clothing_mapping: string;
    solar_mapping: string;
    high_risk_threshold: number;
    fitted_to_dataset: boolean;
  };
  metrics: {
    outcome: string;
    score_vs_measured_pwc_loss: CorrelationMetric;
    environmental_points_vs_measured_pwc_loss: CorrelationMetric;
    comparative_index_correlations: Record<string, CorrelationMetric>;
    below_high_risk_threshold: {
      records: number;
      mean_measured_pwc_loss_percent: number;
    };
    at_or_above_high_risk_threshold: {
      records: number;
      mean_measured_pwc_loss_percent: number;
    };
    mean_loss_difference_percentage_points: number;
    bands: Array<{
      band: string;
      records: number;
      score_minimum: number;
      score_maximum: number;
      mean_measured_pwc_loss_percent: number;
      median_measured_pwc_loss_percent: number;
      p25_measured_pwc_loss_percent: number;
      p75_measured_pwc_loss_percent: number;
    }>;
    input_ranges: Record<string, {
      minimum: number;
      maximum: number;
      unit: string;
    }>;
  };
  interpretation: string;
  limitations: string[];
  citations: Array<{ title: string; doi: string }>;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

export async function runDemo(signal?: AbortSignal): Promise<AnalysisResult> {
  const response = await fetch(`${API_BASE}/api/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Analysis failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function getDemoScenario(signal?: AbortSignal): Promise<DemoScenario> {
  const response = await fetch(`${API_BASE}/api/demo/scenario`, { signal });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Scenario could not be loaded (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function runScenario(payload: ScenarioPayload, signal?: AbortSignal): Promise<AnalysisResult> {
  const response = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const responseText = await response.text();
    let detail = responseText;
    try {
      const body = JSON.parse(responseText) as { detail?: Array<{ msg?: string; loc?: Array<string | number> }> | string };
      if (Array.isArray(body.detail)) {
        detail = body.detail.map((issue) => `${issue.loc?.slice(1).join(" → ") || "scenario"}: ${issue.msg || "invalid value"}`).join("; ");
      } else if (typeof body.detail === "string") {
        detail = body.detail;
      }
    } catch { /* Preserve the plain-text response. */ }
    throw new Error(`Scenario analysis failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function getHeatshieldValidation(signal?: AbortSignal): Promise<HeatshieldValidation> {
  const response = await fetch(`${API_BASE}/api/validation/heatshield`, { signal });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Validation evidence failed (${response.status}): ${detail}`);
  }
  return response.json();
}
