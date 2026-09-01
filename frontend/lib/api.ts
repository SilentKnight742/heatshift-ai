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

export type DataStatus = "ready" | "degraded" | "unavailable" | "provisioning" | "failed";
export type JobStatus = "pending" | "in_progress" | "completed" | "cancelled" | "deferred";
export type PlanLayer = "original" | "heatshift" | "working";

export interface StateOption { code: string; name: string }
export interface WorkspaceState {
  workspace_id: string;
  week_start: string;
  live_site_week_used: boolean;
  live_site_weeks_remaining: number;
  walkthrough_completed: boolean;
}
export interface WeeklySite {
  site_id: string;
  owner_id: string | null;
  name: string;
  state_code: string;
  site_type: string;
  geometry: GeoJSONFeatureCollection;
  centroid: GeoPoint;
  timezone: string;
  curated: boolean;
  fictional_operation: boolean;
  data_status: DataStatus;
  evidence_week_start: string | null;
  source_label: string;
  thermal_burden: number | null;
}
export interface GeoJSONGeometry { type: string; coordinates: unknown }
export interface GeoJSONFeature { type: "Feature"; properties: Record<string, unknown>; geometry: GeoJSONGeometry }
export interface GeoJSONFeatureCollection { type: "FeatureCollection"; features: GeoJSONFeature[] }
export interface WeeklyCrew {
  crew_id: string;
  site_id: string;
  name: string;
  worker_count: number;
  acclimatization_status: string;
  ppe_level: string;
  default_workload: string;
}
export interface WeeklyJob {
  job_id: string;
  site_id: string;
  name: string;
  location: GeoPoint;
  duration_minutes: number;
  workload: string;
  original_start: string;
  earliest_start: string;
  latest_finish: string;
  assigned_crew_id: string;
  eligible_crew_ids: string[];
  dependencies: string[];
  movable: boolean;
  shaded: boolean;
  status: JobStatus;
}
export interface HourlyCondition {
  timestamp: string;
  temperature_c: number;
  apparent_temperature_c: number;
  wet_bulb_temperature_c: number;
  relative_humidity_percent: number;
  solar_irradiance_ghi_wm2: number;
  source: "FortyGuard" | "HeatShift-derived" | "demonstration";
  activity_id: string | null;
}
export interface HeatCell {
  cell_id: string;
  geometry: GeoJSONGeometry;
  temperature_c_1500: number;
  apparent_temperature_c: number;
  source: "FortyGuard" | "HeatShift-derived" | "demonstration";
}
export interface SiteDay {
  date: string;
  conditions: HourlyCondition[];
  heat_cells: HeatCell[];
  satellite_context: Record<string, number>;
  heatmap_activity_id: string | null;
  environmental_activity_id: string | null;
  integrity_sha256: string | null;
}
export interface ScheduleEntry {
  job_id: string;
  crew_id: string;
  start: string;
  end: string;
  source: PlanLayer;
  screening_score: number;
}
export interface DisruptionComponents {
  total_minutes_shifted: number;
  crew_reassignments: number;
  cross_day_moves: number;
  manager_deferrals: number;
  cancellations: number;
  hard_constraint_violations: number;
}
export interface WeeklyMetrics {
  original_exposure_worker_minutes: number;
  proposed_exposure_worker_minutes: number;
  high_risk_hours_avoided: number;
  risk_reduction_percent: number;
  tasks_rescheduled: number;
  fixed_tasks_preserved: number;
  residual_alerts: number;
  productive_task_time_retained_percent: number;
  constraint_valid: boolean;
  site_thermal_burden_degree_hours: number;
  original_crew_exposure_load: number;
  proposed_crew_exposure_load: number;
  highest_loaded_crew_id: string | null;
  crew_load_spread: number;
  disruption: DisruptionComponents;
}
export interface MetricExplanation {
  metric: string;
  definition: string;
  formula: string;
  inputs: Record<string, unknown>;
  source: string;
  comparison: string;
  limitations: string[];
}
export interface WeeklyAnalysis {
  analysis_id: string;
  site_id: string;
  week_start: string;
  policy_version: string;
  original: ScheduleEntry[];
  heatshift: ScheduleEntry[];
  working: ScheduleEntry[];
  plan_metrics: Partial<Record<PlanLayer, WeeklyMetrics>>;
  metrics: WeeklyMetrics;
  explanations: Record<string, MetricExplanation>;
  recommendations: string[];
  limitations: string[];
  briefing_markdown: string;
  briefing_mode: string;
}
export interface SiteWorkspace {
  site: WeeklySite;
  crews: WeeklyCrew[];
  jobs: WeeklyJob[];
  days: SiteDay[];
  analysis: WeeklyAnalysis | null;
}
export interface ProvisionStatus {
  provisioning_id: string;
  site_id: string;
  state: "validating" | "reserved" | "submitting" | "polling" | "ready" | "degraded" | "failed";
  completed_stages: string[];
  pending_stages: string[];
  reserved_credits: number;
  activity_ids: Record<string, string>;
  error: string | null;
}
export interface AuthSession { accessToken: string | null; workspaceId: string; mode: "supabase" | "local"; refreshToken?: string; expiresAt?: number }

const SESSION_KEY = "heatshift-anonymous-session-v2";

export async function getAnonymousSession(): Promise<AuthSession> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const saved = typeof window !== "undefined" ? window.localStorage.getItem(SESSION_KEY) : null;
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as AuthSession;
      if (!parsed.expiresAt || parsed.expiresAt > Date.now() + 60_000) return parsed;
      if (parsed.mode === "supabase" && parsed.refreshToken && supabaseUrl && publishableKey) {
        const refreshed = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: { apikey: publishableKey, "content-type": "application/json" },
          body: JSON.stringify({ refresh_token: parsed.refreshToken }),
        });
        if (refreshed.ok) {
          const body = await refreshed.json() as { access_token: string; refresh_token: string; expires_in?: number; user?: { id?: string } };
          const session: AuthSession = { accessToken: body.access_token, refreshToken: body.refresh_token, workspaceId: body.user?.id || parsed.workspaceId, mode: "supabase", expiresAt: Date.now() + (body.expires_in || 3600) * 1000 };
          window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
          return session;
        }
      }
    } catch { /* Replace a corrupt session. */ }
  }
  if (supabaseUrl && publishableKey) {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: publishableKey, authorization: `Bearer ${publishableKey}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("Anonymous workspace could not be created.");
    const body = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number; user?: { id?: string } };
    const session = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      workspaceId: body.user?.id || "anonymous",
      mode: "supabase" as const,
      expiresAt: Date.now() + (body.expires_in || 3600) * 1000,
    };
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }
  let workspaceId = `local-${crypto.randomUUID()}`;
  if (saved) {
    try { workspaceId = (JSON.parse(saved) as { workspaceId?: string }).workspaceId || workspaceId; }
    catch { window.localStorage.removeItem(SESSION_KEY); }
  }
  const session: AuthSession = { accessToken: null, workspaceId, mode: "local" };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function workspaceFetch<T>(session: AuthSession, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (session.accessToken) headers.set("authorization", `Bearer ${session.accessToken}`);
  else headers.set("x-heatshift-workspace", session.workspaceId);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      throw new Error(parsed.detail || `Request failed (${response.status})`);
    } catch (error) {
      if (error instanceof Error && !error.message.startsWith("Unexpected")) throw error;
      throw new Error(body || `Request failed (${response.status})`);
    }
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const weeklyApi = {
  states: (session: AuthSession) => workspaceFetch<StateOption[]>(session, "/api/states"),
  workspace: (session: AuthSession) => workspaceFetch<WorkspaceState>(session, "/api/workspace"),
  patchWorkspace: (session: AuthSession, patch: Partial<WorkspaceState>) => workspaceFetch<WorkspaceState>(session, "/api/workspace", { method: "PATCH", body: JSON.stringify(patch) }),
  sites: (session: AuthSession, stateCode: string) => workspaceFetch<WeeklySite[]>(session, `/api/states/${stateCode}/sites`),
  site: (session: AuthSession, siteId: string) => workspaceFetch<SiteWorkspace>(session, `/api/sites/${siteId}`),
  createSite: (session: AuthSession, payload: Record<string, unknown>) => workspaceFetch<WeeklySite>(session, "/api/sites", { method: "POST", body: JSON.stringify(payload) }),
  patchSite: (session: AuthSession, siteId: string, patch: Record<string, unknown>) => workspaceFetch<WeeklySite>(session, `/api/sites/${siteId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSite: (session: AuthSession, siteId: string) => workspaceFetch<void>(session, `/api/sites/${siteId}`, { method: "DELETE" }),
  createCrew: (session: AuthSession, siteId: string, payload: Record<string, unknown>) => workspaceFetch<WeeklyCrew>(session, `/api/sites/${siteId}/crews`, { method: "POST", body: JSON.stringify(payload) }),
  patchCrew: (session: AuthSession, siteId: string, crewId: string, patch: Record<string, unknown>) => workspaceFetch<WeeklyCrew>(session, `/api/sites/${siteId}/crews/${crewId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCrew: (session: AuthSession, siteId: string, crewId: string) => workspaceFetch<void>(session, `/api/sites/${siteId}/crews/${crewId}`, { method: "DELETE" }),
  createJob: (session: AuthSession, siteId: string, payload: Record<string, unknown>) => workspaceFetch<WeeklyJob>(session, `/api/sites/${siteId}/jobs`, { method: "POST", body: JSON.stringify(payload) }),
  patchJob: (session: AuthSession, siteId: string, jobId: string, patch: Record<string, unknown>) => workspaceFetch<WeeklyJob>(session, `/api/sites/${siteId}/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteJob: (session: AuthSession, siteId: string, jobId: string) => workspaceFetch<void>(session, `/api/sites/${siteId}/jobs/${jobId}`, { method: "DELETE" }),
  optimize: (session: AuthSession, siteId: string) => workspaceFetch<WeeklyAnalysis>(session, `/api/sites/${siteId}/plans/optimize`, { method: "POST" }),
  workingPlan: (session: AuthSession, siteId: string, entries: ScheduleEntry[]) => workspaceFetch<WeeklyAnalysis>(session, `/api/sites/${siteId}/plans/working`, { method: "PATCH", body: JSON.stringify({ entries }) }),
  ask: (session: AuthSession, analysisId: string, question: string, context: Record<string, unknown>) => workspaceFetch<{ answer_markdown: string; mode: string; remaining_today: number }>(session, `/api/analyses/${analysisId}/questions`, { method: "POST", body: JSON.stringify({ question, context }) }),
  provision: (session: AuthSession, siteId: string, turnstileToken: string, idempotencyKey: string, weekStart: string) => workspaceFetch<ProvisionStatus>(session, `/api/sites/${siteId}/provision/advance`, { method: "POST", body: JSON.stringify({ turnstile_token: turnstileToken, idempotency_key: idempotencyKey, week_start: weekStart }) }),
  provisionStatus: (session: AuthSession, siteId: string) => workspaceFetch<ProvisionStatus>(session, `/api/sites/${siteId}/provision`),
};
