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

