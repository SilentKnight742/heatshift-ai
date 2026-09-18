"use client";

import { FormEvent, Fragment, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ConsoleGuide from "@/components/ConsoleGuide";
import DailyMap, { pointInGeometry, temperatureForCell, temperatureScaleForEvidence, type CellSelection, type TemperatureScale } from "@/components/DailyMap";
import OperationsMethodology from "@/components/OperationsMethodology";
import { stateCentre } from "@/lib/us-states";
import {
  dailyApi,
  getAnonymousSession,
  type AuthSession,
  type DailyAnalysis,
  type DailyEvidence,
  type DailyJob,
  type DailyProviderStatus,
  type DailyScheduleEntry,
  type DailySite,
  type DailyWorkspace,
  type MetricExplanation,
  type StateOption,
} from "@/lib/api";

type PlanLayer = "original" | "heatshift";
type DrawerState = { kind: "cell" | "metric"; key: string } | null;
type MetricCard = { key: string; label: string; value: string; note: string; main?: boolean; tone?: "good" | "warn" | "neutral" };
type DragBinding<T extends HTMLElement = HTMLElement> = {
  ref: RefObject<T | null>;
  style: CSSProperties | undefined;
  handleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  };
};

const DEFAULT_SIMULATION = { seed: 42, crew_count: 8, jobs_per_crew: 5 };

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function timeLabel(value: string) {
  return value.slice(11, 16);
}

function minuteOfDay(value: string) {
  return Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
}

function addMinutes(value: string, minutes: number) {
  const match = value.match(/^(.+T)(\d{2}):(\d{2})(:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return value;
  const total = Number(match[2]) * 60 + Number(match[3]) + minutes;
  return `${match[1]}${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}${match[4] || ":00"}${match[5]}`;
}

function overlapsHour(entry: DailyScheduleEntry | undefined, hour: number) {
  if (!entry) return false;
  return minuteOfDay(entry.start) < (hour + 1) * 60 && minuteOfDay(entry.end) > hour * 60;
}

function workflowLabel(site: DailySite) {
  if (site.workflow_stage === "analyzed") return "Analysis ready";
  if (site.workflow_stage === "simulation_ready") return "Simulation ready";
  return "Site created";
}

function analysisStatusLabel(site: DailySite) {
  return site.workflow_stage === "analyzed" ? "Analysis ready" : "Analysis not ready";
}

function useDraggableOverlay<T extends HTMLElement = HTMLElement>(): DragBinding<T> {
  const ref = useRef<T | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !ref.current?.parentElement) return;
    const rect = ref.current.getBoundingClientRect();
    const frame = ref.current.parentElement.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left - frame.left, top: rect.top - frame.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    const element = ref.current;
    const parent = element?.parentElement;
    if (!current || current.pointerId !== event.pointerId || !element || !parent) return;
    const frame = parent.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(frame.width - rect.width - 8, current.left + event.clientX - current.startX)),
      top: Math.max(8, Math.min(frame.height - rect.height - 8, current.top + event.clientY - current.startY)),
    });
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    ref,
    style: position ? { left: position.left, top: position.top, right: "auto", bottom: "auto", transform: "none" } : undefined,
    handleProps: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish },
  };
}

function evidenceLabel(site: DailySite) {
  return site.evidence_kind === "fortyguard_cached" ? "Cached FortyGuard evidence" : "Locally simulated weather";
}

function originalSchedule(jobs: DailyJob[]): DailyScheduleEntry[] {
  return jobs.map((job) => ({
    job_id: job.job_id,
    crew_id: job.assigned_crew_id,
    start: job.original_start,
    end: addMinutes(job.original_start, job.duration_minutes),
    source: "original",
    screening_score: 0,
  }));
}

function metricCards(analysis: DailyAnalysis): MetricCard[] {
  const metrics = analysis.metrics;
  return [
    { key: "risk_reduction", label: "Exposure reduction", value: `${metrics.risk_reduction_percent.toFixed(1)}%`, note: `${metrics.original_exposure_worker_minutes.toLocaleString()} → ${metrics.proposed_exposure_worker_minutes.toLocaleString()} worker-min`, main: true, tone: "good" },
    { key: "high_risk_time", label: "High-risk time avoided", value: `${metrics.high_risk_hours_avoided.toFixed(1)} h`, note: "worker-hours above score 50", tone: "good" },
    { key: "thermal_burden", label: "Site Thermal Burden", value: metrics.site_thermal_burden_degree_hours.toFixed(1), note: "apparent-temperature degree-hours", tone: "warn" },
    { key: "crew_load", label: "Crew Exposure Load", value: metrics.proposed_crew_exposure_load.toFixed(1), note: `${metrics.original_crew_exposure_load.toFixed(1)} before`, tone: "good" },
    { key: "tasks_rescheduled", label: "Tasks moved", value: String(metrics.tasks_rescheduled), note: `${metrics.disruption.total_minutes_shifted.toLocaleString()} shifted minutes`, tone: "neutral" },
    { key: "fixed_preserved", label: "Fixed jobs preserved", value: String(metrics.fixed_tasks_preserved), note: "left in place", tone: "neutral" },
    { key: "residual_alerts", label: "Still exposed", value: String(metrics.residual_alerts), note: "jobs remain at score 50+", tone: metrics.residual_alerts ? "warn" : "good" },
    { key: "retained_work", label: "Work retained", value: `${metrics.productive_task_time_retained_percent.toFixed(0)}%`, note: "scheduled task time", tone: "good" },
    { key: "constraint_validity", label: "Hard violations", value: String(metrics.disruption.hard_constraint_violations), note: metrics.constraint_valid ? "constraint-valid plan" : "review required", tone: metrics.constraint_valid ? "good" : "warn" },
    { key: "disruption", label: "Crew changes", value: String(metrics.disruption.crew_reassignments), note: "reassignments", tone: "neutral" },
  ];
}

function ConditionsHud({ evidence, hour, activeCount, planLayer, onHour, onPlan, drag }: { evidence: DailyEvidence; hour: number; activeCount: number; planLayer: PlanLayer; onHour: (hour: number) => void; onPlan: (layer: PlanLayer) => void; drag: DragBinding<HTMLElement> }) {
  const selected = evidence.conditions.find((item) => Number(item.timestamp.slice(11, 13)) === hour) || evidence.conditions[0];
  const apparent = evidence.conditions.map((item) => item.apparent_temperature_c);
  const minimum = Math.min(...apparent) - 1;
  const maximum = Math.max(...apparent) + 1;
  const points = apparent.map((value, index) => `${index / Math.max(apparent.length - 1, 1) * 150},${34 - (value - minimum) / Math.max(maximum - minimum, 1) * 28}`).join(" ");
  return <section ref={drag.ref} style={drag.style} className="map-environment-hud" aria-label="Hourly environmental conditions">
    <button className="map-overlay-drag-handle" type="button" aria-label="Move hourly conditions panel" title="Drag to move" {...drag.handleProps}>⠿</button>
    <div className="map-environment-summary">
      <div className="map-hour-readout"><span>Hour</span><strong>{String(hour).padStart(2, "0")}:00</strong></div>
      <svg viewBox="0 0 150 38" role="img" aria-label="Daily apparent-temperature curve"><polyline points={points} /><circle cx={hour / 23 * 150} cy={34 - (selected.apparent_temperature_c - minimum) / Math.max(maximum - minimum, 1) * 28} r="3.5" /></svg>
      <div className="map-condition-grid">
        <div className="map-condition-value primary" title="Grid-average apparent temperature"><span>Grid avg.</span><strong>{selected.apparent_temperature_c.toFixed(1)}°C</strong></div>
        <div className="map-condition-value"><span>Air temp</span><strong>{selected.temperature_c.toFixed(1)}°C</strong></div>
        <div className="map-condition-value"><span>Wet bulb</span><strong>{selected.wet_bulb_temperature_c.toFixed(1)}°C</strong></div>
        <div className="map-condition-value"><span>Humidity</span><strong>{selected.relative_humidity_percent.toFixed(0)}%</strong></div>
        <div className="map-condition-value"><span>Solar W/m²</span><strong>{selected.solar_irradiance_ghi_wm2.toFixed(0)}</strong></div>
        <div className="map-condition-value active"><span>Ongoing</span><strong>{activeCount}</strong></div>
      </div>
      <div className="map-plan-switch" role="tablist" aria-label="Schedule shown on map"><button type="button" role="tab" aria-selected={planLayer === "original"} onClick={() => onPlan("original")}>Original</button><button type="button" role="tab" aria-selected={planLayer === "heatshift"} onClick={() => onPlan("heatshift")}>HeatShift</button></div>
    </div>
    <label className="map-hour-slider"><span>00</span><input aria-label="Selected local hour" type="range" min="0" max="23" value={hour} onChange={(event) => onHour(Number(event.target.value))} /><span>23</span></label>
  </section>;
}

function FloatingBriefing({ analysis, expanded, onToggle, drag }: { analysis: DailyAnalysis; expanded: boolean; onToggle: () => void; drag: DragBinding<HTMLElement> }) {
  return <section ref={drag.ref} style={drag.style} className={`map-floating-briefing ${expanded ? "expanded" : "collapsed"}`} aria-label="AI operational briefing">
    <header><div><span className="eyebrow">HeatShift agent</span><h2>Operational briefing</h2></div><div className="map-floating-briefing-actions"><button className="map-floating-briefing-drag" type="button" aria-label="Move AI briefing" title="Drag to move" {...drag.handleProps}>⠿</button><button className="map-floating-toggle" type="button" aria-label={expanded ? "Collapse AI briefing" : "Expand AI briefing"} aria-expanded={expanded} onClick={onToggle}>{expanded ? "⌃" : "⌄"}</button></div></header>
    {expanded && <div className="map-floating-briefing-scroll"><div className="briefing-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{analysis.briefing_markdown}</ReactMarkdown></div><div className="drawer-limit"><strong>Authority boundary</strong><p>The briefing explains the deterministic result. It cannot alter the schedule or metrics.</p></div></div>}
  </section>;
}

function ExplanationContent({ explanation }: { explanation: MetricExplanation }) {
  return <>
    <p className="drawer-lead">{explanation.definition}</p>
    <dl>
      <div><dt>Result</dt><dd>{explanation.comparison}</dd></div>
      <div><dt>Formula</dt><dd><code>{explanation.formula}</code></dd></div>
      <div><dt>Inputs</dt><dd><pre>{JSON.stringify(explanation.inputs, null, 2)}</pre></dd></div>
      <div><dt>Source</dt><dd>{explanation.source}</dd></div>
    </dl>
    <div className="drawer-limit"><strong>Read this carefully</strong>{explanation.limitations.map((item) => <p key={item}>{item}</p>)}</div>
  </>;
}

function FloatingAnalytics({ metric, explanation, expanded, onToggle, drag }: { metric: MetricCard | null; explanation: MetricExplanation | null; expanded: boolean; onToggle: () => void; drag: DragBinding<HTMLElement> }) {
  return <section ref={drag.ref} style={drag.style} className={`map-floating-analytics ${expanded ? "expanded" : "collapsed"}`} aria-label="HeatShift analytics">
    <header><div><span className="eyebrow">HeatShift analytics</span><h2>{metric?.label || "Analysis results"}</h2>{metric && <strong>{metric.value}</strong>}</div><div className="map-floating-analytics-actions"><button className="map-floating-analytics-drag" type="button" aria-label="Move analytics panel" title="Drag to move" {...drag.handleProps}>⠿</button><button className="map-floating-toggle" type="button" aria-label={expanded ? "Collapse analytics" : "Expand analytics"} aria-expanded={expanded} onClick={onToggle}>{expanded ? "⌃" : "⌄"}</button></div></header>
    {expanded && <div className="map-floating-analytics-scroll">{metric ? explanation ? <ExplanationContent explanation={explanation} /> : <p className="drawer-lead">A detailed explanation is not available for this result.</p> : <div className="analytics-empty"><strong>Choose a result</strong><p>Select any metric along the bottom of the map to inspect its formula, inputs, comparison and limitations.</p></div>}</div>}
  </section>;
}

function MapDrawer({ drawer, data, hour, schedule, onClose }: { drawer: NonNullable<DrawerState>; data: DailyWorkspace; hour: number; schedule: DailyScheduleEntry[]; onClose: () => void }) {
  const scheduleByJob = new Map(schedule.map((entry) => [entry.job_id, entry]));
  const crewById = new Map(data.crews.map((crew) => [crew.crew_id, crew]));
  if (drawer.kind === "cell" && data.evidence) {
    const cell = data.evidence.heat_cells.find((item) => item.cell_id === drawer.key);
    if (!cell) return null;
    const temperature = temperatureForCell(data.evidence, cell.cell_id, hour) ?? cell.apparent_temperature_c;
    const jobs = data.jobs.filter((job) => pointInGeometry(job.location.longitude, job.location.latitude, cell.geometry));
    return <aside className="map-detail-drawer"><header><div><span className="eyebrow">Selected 100 m cell</span><h2>{temperature.toFixed(2)}°C apparent</h2><span>{String(hour).padStart(2, "0")}:00 local · {jobs.length} jobs located here</span></div><button type="button" onClick={onClose} aria-label="Close details">×</button></header><div className="map-drawer-scroll"><dl><div><dt>Cell</dt><dd>{cell.cell_id}</dd></div><div><dt>15:00 field</dt><dd>{cell.temperature_c_1500.toFixed(2)}°C</dd></div><div><dt>Source</dt><dd>{cell.source}</dd></div><div><dt>Method</dt><dd>Hourly site apparent temperature plus this cell&apos;s difference from the 15:00 field mean.</dd></div></dl><section className="cell-jobs"><div><span className="eyebrow">Operations in this cell</span><strong>{jobs.filter((job) => overlapsHour(scheduleByJob.get(job.job_id), hour)).length} ongoing now</strong></div>{jobs.length ? jobs.map((job) => { const entry = scheduleByJob.get(job.job_id); const active = overlapsHour(entry, hour); const earlier = entry ? minuteOfDay(entry.end) <= hour * 60 : false; return <article className={active ? "active" : ""} key={job.job_id}><i /><div><strong>{job.name}</strong><span>{crewById.get(entry?.crew_id || job.assigned_crew_id)?.name || "Unassigned"} · {entry ? `${timeLabel(entry.start)}–${timeLabel(entry.end)}` : timeLabel(job.original_start)}</span><small>{active ? "Ongoing" : earlier ? "Earlier today" : "Upcoming"} · {job.workload.replace("_", " ")} workload{entry?.screening_score ? ` · score ${entry.screening_score}` : ""}</small></div></article>; }) : <p>No generated jobs are located inside this cell.</p>}</section><div className="drawer-limit"><strong>Estimate, not a sensor</strong><p>This cell is a HeatShift hourly reconstruction. It is not a building, worker or wearable measurement.</p></div></div></aside>;
  }
  return null;
}

function CreateSiteDialog({ open, state, point, onClose, onCreate }: { open: boolean; state: StateOption | undefined; point: { longitude: number; latitude: number } | null; onClose: () => void; onCreate: (payload: Record<string, unknown>) => Promise<void> }) {
  const centre = state ? stateCentre(state.code) : { longitude: -112.0675, latitude: 33.4515 };
  const [name, setName] = useState("New operation site");
  const [siteType, setSiteType] = useState("outdoor operations site");
  const [longitude, setLongitude] = useState(String(point?.longitude ?? centre.longitude));
  const [latitude, setLatitude] = useState(String(point?.latitude ?? centre.latitude));
  const [radius, setRadius] = useState("600");
  const [operationDate, setOperationDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setLongitude(String(point?.longitude ?? centre.longitude)); setLatitude(String(point?.latitude ?? centre.latitude)); } }, [open, point, centre.longitude, centre.latitude]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, busy, onClose]);
  if (!open || !state) return null;
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { await onCreate({ name, state_code: state.code, site_type: siteType, operation_date: operationDate, geometry: { type: "coordinates", longitude: Number(longitude), latitude: Number(latitude), radius_m: Number(radius) } }); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Site could not be created."); } finally { setBusy(false); } };
  return <div className="walkthrough-backdrop create-site-backdrop" role="dialog" aria-modal="true" aria-label="Create daily operation site"><form className="create-site-card daily-create-card" onSubmit={submit}><button type="button" className="walkthrough-close" onClick={onClose} aria-label="Close">×</button><span className="eyebrow">New site · {state.name}</span><h2>Choose the operation location</h2><p>Tip: double-clicking the map fills these coordinates. New-site weather remains explicitly simulated in this local milestone.</p><label><span>Site name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} required /></label><label><span>Operation type</span><input value={siteType} onChange={(event) => setSiteType(event.target.value)} required /></label><div className="field-pair"><label><span>Longitude</span><input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} required /></label><label><span>Latitude</span><input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} required /></label></div><div className="field-pair"><label><span>Site radius · metres</span><input type="number" min="100" max="5000" value={radius} onChange={(event) => setRadius(event.target.value)} required /></label><label><span>Simulation date</span><input type="date" min="2019-01-01" max={new Date().toISOString().slice(0, 10)} value={operationDate} onChange={(event) => setOperationDate(event.target.value)} required /></label></div>{error && <p className="dialog-error" role="alert">{error}</p>}<button className="create-site-submit" type="submit" disabled={busy}>{busy ? "Creating…" : "Create site"}</button></form></div>;
}

export default function DailyConsole() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [states, setStates] = useState<StateOption[]>([]);
  const [allSites, setAllSites] = useState<DailySite[]>([]);
  const [stateCode, setStateCode] = useState("AZ");
  const [data, setData] = useState<DailyWorkspace | null>(null);
  const [hour, setHour] = useState(15);
  const [planLayer, setPlanLayer] = useState<PlanLayer>("heatshift");
  const [simulation, setSimulation] = useState(DEFAULT_SIMULATION);
  const [busy, setBusy] = useState<"loading" | "generating" | "analyzing" | null>("loading");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mapPoint, setMapPoint] = useState<{ longitude: number; latitude: number } | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [providerStatus, setProviderStatus] = useState<DailyProviderStatus | null>(null);
  const [providerChecking, setProviderChecking] = useState(false);
  const [briefingExpanded, setBriefingExpanded] = useState(true);
  const [analyticsExpanded, setAnalyticsExpanded] = useState(false);
  const [stateHeatScale, setStateHeatScale] = useState<TemperatureScale | null>(null);
  const stateSites = useMemo(() => allSites.filter((site) => site.state_code === stateCode), [allSites, stateCode]);
  const stateEvidenceKey = stateSites.map((site) => `${site.site_id}:${site.workflow_stage}`).join("|");
  const currentState = states.find((state) => state.code === stateCode);
  const schedule = useMemo(() => data?.analysis ? data.analysis[planLayer] : originalSchedule(data?.jobs || []), [data, planLayer]);
  const cards = useMemo(() => data?.analysis ? metricCards(data.analysis) : [], [data?.analysis]);
  const activeCount = schedule.filter((entry) => overlapsHour(entry, hour)).length;
  const conditionsDrag = useDraggableOverlay<HTMLElement>();
  const legendDrag = useDraggableOverlay<HTMLDivElement>();
  const briefingDrag = useDraggableOverlay<HTMLElement>();
  const analyticsDrag = useDraggableOverlay<HTMLElement>();
  const displayedHeatScale = stateHeatScale || temperatureScaleForEvidence(data?.evidence ? [data.evidence] : []) || { minimum: 0, maximum: 55 };
  const heatScaleTicks = Array.from({ length: 5 }, (_, index) => Math.round(displayedHeatScale.minimum + (displayedHeatScale.maximum - displayedHeatScale.minimum) * index / 4));

  const loadSite = async (activeSession: AuthSession, siteId: string) => {
    const workspace = await dailyApi.site(activeSession, siteId);
    setData(workspace);
    setStateCode(workspace.site.state_code);
    setPlanLayer(workspace.analysis ? "heatshift" : "original");
    setDrawer(null);
    setBriefingExpanded(Boolean(workspace.analysis));
    setAnalyticsExpanded(false);
    setAllSites((items) => items.map((site) => site.site_id === workspace.site.site_id ? workspace.site : site));
  };
  useEffect(() => { let cancelled = false; void (async () => { try { const active = await getAnonymousSession(); void dailyApi.providerStatus(active).then((status) => { if (!cancelled) setProviderStatus(status); }).catch(() => { if (cancelled) return; setProviderStatus({ state: "provider_unavailable", live_available: false, fallback_active: true, credits_remaining: null, checked_at: new Date().toISOString(), message: "FortyGuard availability could not be confirmed. Cached and simulated evidence remain available." }); }); const [stateList, sites] = await Promise.all([dailyApi.states(active), dailyApi.sites(active)]); if (cancelled) return; setSession(active); setStates(stateList); setAllSites(sites); } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : "The daily console could not be loaded."); } finally { if (!cancelled) setBusy(null); } })(); return () => { cancelled = true; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setStateHeatScale(null);
    if (!session || !stateSites.length) return () => { cancelled = true; };
    void Promise.all(stateSites.map((site) => dailyApi.site(session, site.site_id).catch(() => null))).then((workspaces) => {
      if (cancelled) return;
      setStateHeatScale(temperatureScaleForEvidence(workspaces.flatMap((workspace) => workspace?.evidence ? [workspace.evidence] : [])));
    });
    return () => { cancelled = true; };
  }, [session, stateCode, stateEvidenceKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 280);
    return () => window.clearTimeout(timer);
  }, [sidebarCollapsed]);
  useEffect(() => {
    const openGuide = () => setGuideOpen(true);
    const requestReset = () => setResetOpen(true);
    window.addEventListener("heatshift:open-guide", openGuide);
    window.addEventListener("heatshift:reset-request", requestReset);
    return () => {
      window.removeEventListener("heatshift:open-guide", openGuide);
      window.removeEventListener("heatshift:reset-request", requestReset);
    };
  }, []);
  const chooseState = (code: string) => { setStateCode(code); setData(null); setDrawer(null); setPanelOpen(false); setBriefingExpanded(false); setAnalyticsExpanded(false); };
  const chooseSite = async (siteId: string) => { if (!session) return; setBusy("loading"); setError(null); try { await loadSite(session, siteId); setPanelOpen(false); } catch (caught) { setError(caught instanceof Error ? caught.message : "Site could not be loaded."); } finally { setBusy(null); } };
  const generate = async () => { if (!session || !data) return; setBusy("generating"); setError(null); try { const workspace = await dailyApi.generate(session, data.site.site_id, simulation); setData(workspace); setPlanLayer("original"); setDrawer(null); setBriefingExpanded(false); setAnalyticsExpanded(false); setAllSites((items) => items.map((site) => site.site_id === workspace.site.site_id ? workspace.site : site)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Simulation could not be generated."); } finally { setBusy(null); } };
  const analyze = async () => { if (!session || !data) return; setBusy("analyzing"); setError(null); try { const analysis = await dailyApi.analyze(session, data.site.site_id); const workspace = { ...data, analysis, site: { ...data.site, workflow_stage: "analyzed" as const } }; setData(workspace); setPlanLayer("heatshift"); setDrawer(null); setBriefingExpanded(true); setAnalyticsExpanded(false); setAllSites((items) => items.map((site) => site.site_id === workspace.site.site_id ? workspace.site : site)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Analysis could not be completed."); } finally { setBusy(null); } };
  const createSite = async (payload: Record<string, unknown>) => { if (!session) return; const site = await dailyApi.createSite(session, payload); setAllSites(await dailyApi.sites(session)); await loadSite(session, site.site_id); };
  const removeSite = async () => { if (!session || !data || data.site.curated || !window.confirm(`Delete ${data.site.name}?`)) return; await dailyApi.deleteSite(session, data.site.site_id); setAllSites(await dailyApi.sites(session)); setData(null); setDrawer(null); setBriefingExpanded(false); setAnalyticsExpanded(false); };
  const resetWorkspace = async () => {
    if (!session) return;
    setBusy("loading");
    setError(null);
    try {
      const sites = await dailyApi.reset(session);
      setAllSites(sites);
      setStateCode("AZ");
      setData(null);
      setHour(15);
      setPlanLayer("heatshift");
      setSimulation(DEFAULT_SIMULATION);
      setDrawer(null);
      setSidebarCollapsed(false);
      setPanelOpen(false);
      setBriefingExpanded(false);
      setAnalyticsExpanded(false);
      setMethodOpen(false);
      setResetOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The workspace could not be reset.");
    } finally {
      setBusy(null);
    }
  };
  const refreshProviderStatus = useCallback(async () => {
    if (!session) return;
    setProviderChecking(true);
    try {
      const status = await dailyApi.providerStatus(session, true);
      setProviderStatus(status);
    } catch {
      setProviderStatus({ state: "provider_unavailable", live_available: false, fallback_active: true, credits_remaining: null, checked_at: new Date().toISOString(), message: "FortyGuard availability could not be confirmed. Cached and simulated evidence remain available." });
    } finally {
      setProviderChecking(false);
    }
  }, [session]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("heatshift:provider-status", { detail: { status: providerStatus?.state || null, checking: providerChecking } }));
  }, [providerStatus, providerChecking]);
  useEffect(() => {
    const retry = () => { void refreshProviderStatus(); };
    window.addEventListener("heatshift:provider-retry", retry);
    return () => window.removeEventListener("heatshift:provider-retry", retry);
  }, [refreshProviderStatus]);
  const selectedMetric = drawer?.kind === "metric" ? cards.find((card) => card.key === drawer.key) || null : null;
  const selectedExplanation = selectedMetric && data?.analysis ? data.analysis.explanations[selectedMetric.key] || null : null;
  const toggleBriefing = () => setBriefingExpanded((current) => !current);
  const toggleAnalytics = () => setAnalyticsExpanded((current) => !current);
  const toggleMetric = (key: string) => {
    const open = analyticsExpanded && drawer?.kind === "metric" && drawer.key === key;
    if (open) { setAnalyticsExpanded(false); setDrawer(null); return; }
    setDrawer({ kind: "metric", key });
    setAnalyticsExpanded(true);
  };

  if (busy === "loading" && !session) return <div className="weekly-initializing"><div className="loading-orbit"><i /><i /><i /></div><h1>Preparing the operations map</h1><p>Loading your sites and daily evidence.</p></div>;
  return <>
    <div className={`map-console-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}><aside className={`map-console-sidebar${panelOpen ? " open" : ""}`}><div className="weekly-sidebar-title"><div><span className="eyebrow">Daily operation</span><h2>Build and analyze</h2></div><div className="map-sidebar-header-actions"><button className="map-sidebar-collapse" type="button" onClick={() => setSidebarCollapsed(true)} aria-label="Collapse setup panel">←</button><button className="map-panel-close" type="button" onClick={() => setPanelOpen(false)} aria-label="Close setup panel">×</button></div></div><div className="sidebar-global-controls"><label><span>State</span><select aria-label="State" value={stateCode} onChange={(event) => chooseState(event.target.value)}>{states.map((state) => <option value={state.code} key={state.code}>{state.name}</option>)}</select></label></div><div className="daily-side-scroll"><section className="daily-sites-section"><span className="daily-side-label">Sites in {currentState?.name || stateCode}</span><div className="weekly-list">{stateSites.length ? stateSites.map((site) => <button className={`site-list-card${data?.site.site_id === site.site_id ? " active" : ""}`} type="button" key={site.site_id} onClick={() => void chooseSite(site.site_id)}><span className="site-list-icon">⌖</span><span><strong>{site.name}</strong><small>{site.site_type}</small><small>{evidenceLabel(site)}</small><em className="daily-card-status">{workflowLabel(site)}</em></span></button>) : <div className="weekly-empty"><strong>No sites yet</strong><p>Double-click anywhere inside the state or create one with coordinates.</p></div>}</div></section>
      {data ? <><section className="daily-simulation-controls"><span className="daily-side-label">Simulation scale</span><label>Random seed<input type="number" min="0" value={simulation.seed} onChange={(event) => setSimulation({ ...simulation, seed: Number(event.target.value) })} /></label><label>Crews<select value={simulation.crew_count} onChange={(event) => setSimulation({ ...simulation, crew_count: Number(event.target.value) })}>{[6, 8, 10, 12].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label>Jobs per crew<select value={simulation.jobs_per_crew} onChange={(event) => setSimulation({ ...simulation, jobs_per_crew: Number(event.target.value) })}>{[3, 4, 5, 6].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><button className="daily-primary-action" type="button" onClick={() => void generate()} disabled={Boolean(busy)}>{busy === "generating" ? "Generating operation…" : data.simulation ? "Generate a new simulation" : "Generate simulation"}</button><button className="daily-analysis-action" type="button" onClick={() => void analyze()} disabled={Boolean(busy) || !data.simulation}>{busy === "analyzing" ? "Running analysis…" : "Run HeatShift analysis"}</button>{data.simulation && <p>{data.simulation.worker_count} workers · {data.simulation.job_count} jobs · seed {data.simulation.seed}<br />{data.simulation.generation_mode === "ai_enriched_stochastic" ? "AI-enriched names + seeded operations" : "Seeded stochastic operations · AI fallback"}</p>}</section>{!data.site.curated && <button className="daily-delete" type="button" onClick={() => void removeSite()}>Delete this local site</button>}</> : <section className="sidebar-map-hint"><strong>Start on the map</strong><p>Choose a site tab or marker. The map will zoom into its thermal cells automatically.</p></section>}
      </div></aside>
      <main className="map-console-main"><section className="map-workspace">
        <DailyMap stateCode={stateCode} sites={stateSites} selectedSite={data?.site || null} evidence={data?.evidence || null} hour={hour} jobs={data?.jobs || []} schedule={schedule} selectedCellId={drawer?.kind === "cell" ? drawer.key : null} heatScale={displayedHeatScale} onSelectSite={(id) => void chooseSite(id)} onSelectCell={(cell: CellSelection) => { setDrawer({ kind: "cell", key: cell.id }); setAnalyticsExpanded(false); }} onMapPoint={(longitude, latitude) => { setMapPoint({ longitude, latitude }); setCreateOpen(true); }} />
        <button className="map-sidebar-restore" type="button" onClick={() => setSidebarCollapsed(false)} aria-label="Expand setup panel"><span>›</span> Setup</button>
        <button className="map-mobile-panel-toggle" type="button" onClick={() => setPanelOpen(true)}>Setup & sites</button>
        <div className="map-site-tabs" role="tablist" aria-label={`${currentState?.name || stateCode} sites`}><button type="button" role="tab" aria-selected={!data} onClick={() => { setData(null); setDrawer(null); setBriefingExpanded(false); setAnalyticsExpanded(false); setMethodOpen(false); }}>All sites <b>{stateSites.length}</b></button>{stateSites.map((site) => <Fragment key={site.site_id}><button type="button" role="tab" aria-selected={data?.site.site_id === site.site_id} onClick={() => void chooseSite(site.site_id)}><i className={`stage-${site.workflow_stage}`} /><span><strong>{site.name}</strong><em>{analysisStatusLabel(site)}</em></span></button>{data?.site.site_id === site.site_id && <button className="map-method-button" type="button" onClick={() => setMethodOpen(true)}>Operation & method <span>↗</span></button>}</Fragment>)}</div>
        <button className="map-create-site-button" type="button" onClick={() => { setMapPoint(null); setCreateOpen(true); }}>+ Create site</button>
        {data?.evidence && <ConditionsHud evidence={data.evidence} hour={hour} activeCount={activeCount} planLayer={planLayer} onHour={setHour} onPlan={(layer) => setPlanLayer(data.analysis ? layer : "original")} drag={conditionsDrag} />}
        <div ref={legendDrag.ref} style={legendDrag.style} className="map-legend"><button className="map-overlay-drag-handle" type="button" aria-label="Move heatmap legend" title="Drag to move" {...legendDrag.handleProps}>⠿</button><strong>{currentState?.name || stateCode} apparent temperature · {String(hour).padStart(2, "0")}:00</strong><div className="map-heat-ramp" aria-label={`${currentState?.name || stateCode} apparent-temperature scale from ${displayedHeatScale.minimum} to ${displayedHeatScale.maximum} degrees Celsius`} /><div className="map-heat-scale">{heatScaleTicks.map((value, index) => <span key={`${value}-${index}`}>{value}°{index === heatScaleTicks.length - 1 ? "C" : ""}</span>)}</div><div className="map-hour-shade-key"><span>Cell shade</span><i /><small>lighter cooler → darker hotter this hour</small></div><div className="map-ongoing-key"><i />Ongoing work</div></div>
        {!data && <div className="map-stage-message overview"><span>⌖</span><strong>{currentState?.name || stateCode} operations</strong><p>Select a site marker or tab. Pan and zoom freely; double-click to place a new site.</p>{!stateSites.length && <button type="button" onClick={() => setCreateOpen(true)}>Create the first site</button>}</div>}
        {data && !data.simulation && <div className="map-stage-message"><span>2</span><strong>Generate this operation</strong><p>The site is ready. Set the scale in the left panel, then generate its crews, jobs and baseline schedule.</p></div>}
        {data?.simulation && !data.analysis && <div className="map-stage-message compact"><span>3</span><strong>Baseline ready</strong><p>{data.simulation.worker_count} workers · {data.simulation.job_count} jobs. Run the analysis to score and restructure the day.</p><button type="button" onClick={() => void analyze()}>Run HeatShift analysis</button></div>}
        {data?.analysis && <><div className={`map-floating-panel-layer${analyticsExpanded ? " analytics-open" : ""}${briefingExpanded ? " briefing-open" : ""}${analyticsExpanded && briefingExpanded ? " both-open" : ""}`}><FloatingAnalytics metric={selectedMetric} explanation={selectedExplanation} expanded={analyticsExpanded} onToggle={toggleAnalytics} drag={analyticsDrag} /><FloatingBriefing analysis={data.analysis} expanded={briefingExpanded} onToggle={toggleBriefing} drag={briefingDrag} /></div><div className="map-metrics-dock" aria-label="Analysis results">{cards.map((card) => { const open = Boolean(analyticsExpanded && drawer?.kind === "metric" && drawer.key === card.key); return <button className={`${card.main ? "main " : ""}${card.tone || "neutral"}`} type="button" key={card.key} aria-expanded={open} onClick={() => toggleMetric(card.key)}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></button>; })}</div></>}
        {busy && <div className="map-progress"><i />{busy === "generating" ? "Generating a large daily operation…" : busy === "analyzing" ? "Scoring every task-hour and optimizing…" : "Loading site…"}</div>}
        {error && <div className="map-console-error" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
        {drawer?.kind === "cell" && data && <MapDrawer drawer={drawer} data={data} hour={hour} schedule={schedule} onClose={() => setDrawer(null)} />}
      </section></main>
    </div>
    <CreateSiteDialog open={createOpen} state={currentState} point={mapPoint} onClose={() => { setCreateOpen(false); setMapPoint(null); }} onCreate={createSite} />
    <ConsoleGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    <OperationsMethodology open={methodOpen} workspace={data} busy={busy} simulation={simulation} onSimulation={setSimulation} onGenerate={() => void generate()} onAnalyze={() => void analyze()} onClose={() => setMethodOpen(false)} />
    {resetOpen && <div className="reset-workspace-backdrop" role="dialog" aria-modal="true" aria-label="Reset HeatShift workspace"><section><span className="reset-symbol">↺</span><div><span className="eyebrow">Return to defaults</span><h2>Reset this workspace?</h2><p>This removes every site you created and restores the three built-in analyzed examples. It also clears the selected state, hour and open result panels.</p></div><div className="reset-actions"><button type="button" onClick={() => setResetOpen(false)}>Keep my work</button><button type="button" onClick={() => void resetWorkspace()} disabled={Boolean(busy)}>{busy === "loading" ? "Resetting…" : "Reset everything"}</button></div></section></div>}
  </>;
}
