"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DailyMap, { pointInGeometry, temperatureForCell, type CellSelection } from "@/components/DailyMap";
import { stateCentre } from "@/lib/us-states";
import {
  dailyApi,
  getAnonymousSession,
  type AuthSession,
  type DailyAnalysis,
  type DailyEvidence,
  type DailyJob,
  type DailyScheduleEntry,
  type DailySite,
  type DailyWorkspace,
  type MetricExplanation,
  type StateOption,
} from "@/lib/api";

type PlanLayer = "original" | "heatshift";
type DrawerState = { kind: "cell" | "metric" | "briefing"; key: string } | null;
type MetricCard = { key: string; label: string; value: string; note: string; main?: boolean; tone?: "good" | "warn" | "neutral" };

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

function ConditionsHud({ evidence, hour, activeCount, planLayer, onHour, onPlan }: { evidence: DailyEvidence; hour: number; activeCount: number; planLayer: PlanLayer; onHour: (hour: number) => void; onPlan: (layer: PlanLayer) => void }) {
  const selected = evidence.conditions.find((item) => Number(item.timestamp.slice(11, 13)) === hour) || evidence.conditions[0];
  const apparent = evidence.conditions.map((item) => item.apparent_temperature_c);
  const minimum = Math.min(...apparent) - 1;
  const maximum = Math.max(...apparent) + 1;
  const points = apparent.map((value, index) => `${index / Math.max(apparent.length - 1, 1) * 150},${34 - (value - minimum) / Math.max(maximum - minimum, 1) * 28}`).join(" ");
  return <section className="map-environment-hud" aria-label="Hourly environmental conditions">
    <div className="map-hour-readout"><span>Local hour</span><strong>{String(hour).padStart(2, "0")}:00</strong></div>
    <svg viewBox="0 0 150 38" role="img" aria-label="Daily apparent-temperature curve"><polyline points={points} /><circle cx={hour / 23 * 150} cy={34 - (selected.apparent_temperature_c - minimum) / Math.max(maximum - minimum, 1) * 28} r="3.5" /></svg>
    <div className="map-condition-value primary"><span>Apparent</span><strong>{selected.apparent_temperature_c.toFixed(1)}°C</strong></div>
    <div className="map-condition-value"><span>Temperature</span><strong>{selected.temperature_c.toFixed(1)}°C</strong></div>
    <div className="map-condition-value"><span>Wet bulb</span><strong>{selected.wet_bulb_temperature_c.toFixed(1)}°C</strong></div>
    <div className="map-condition-value"><span>Humidity</span><strong>{selected.relative_humidity_percent.toFixed(0)}%</strong></div>
    <div className="map-condition-value"><span>Solar GHI</span><strong>{selected.solar_irradiance_ghi_wm2.toFixed(0)}</strong></div>
    <div className="map-condition-value active"><span>Ongoing</span><strong>{activeCount}</strong></div>
    <div className="map-plan-switch" role="tablist" aria-label="Schedule shown on map"><button type="button" role="tab" aria-selected={planLayer === "original"} onClick={() => onPlan("original")}>Original</button><button type="button" role="tab" aria-selected={planLayer === "heatshift"} onClick={() => onPlan("heatshift")}>HeatShift</button></div>
    <label className="map-hour-slider"><span>00</span><input aria-label="Selected local hour" type="range" min="0" max="23" value={hour} onChange={(event) => onHour(Number(event.target.value))} /><span>23</span></label>
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

function MapDrawer({ drawer, data, hour, schedule, metric, onClose }: { drawer: NonNullable<DrawerState>; data: DailyWorkspace; hour: number; schedule: DailyScheduleEntry[]; metric: MetricCard | null; onClose: () => void }) {
  const scheduleByJob = new Map(schedule.map((entry) => [entry.job_id, entry]));
  const crewById = new Map(data.crews.map((crew) => [crew.crew_id, crew]));
  if (drawer.kind === "briefing" && data.analysis) return <aside className="map-detail-drawer"><header><div><span className="eyebrow">HeatShift agent</span><h2>Operational briefing</h2></div><button type="button" onClick={onClose} aria-label="Close details">×</button></header><div className="map-drawer-scroll"><div className="briefing-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{data.analysis.briefing_markdown}</ReactMarkdown></div><div className="drawer-limit"><strong>Authority boundary</strong><p>The briefing explains the deterministic result. It cannot alter the schedule or metrics.</p></div></div></aside>;
  if (drawer.kind === "metric" && data.analysis && metric) {
    const explanation = data.analysis.explanations[drawer.key];
    return <aside className="map-detail-drawer"><header><div><span className="eyebrow">Calculated result</span><h2>{metric.label}</h2><strong className="drawer-metric-value">{metric.value}</strong></div><button type="button" onClick={onClose} aria-label="Close details">×</button></header><div className="map-drawer-scroll">{explanation ? <ExplanationContent explanation={explanation} /> : <p className="drawer-lead">A detailed explanation is not available for this result.</p>}</div></aside>;
  }
  if (drawer.kind === "cell" && data.evidence) {
    const cell = data.evidence.heat_cells.find((item) => item.cell_id === drawer.key);
    if (!cell) return null;
    const temperature = temperatureForCell(data.evidence, cell.cell_id, hour) ?? cell.apparent_temperature_c;
    const jobs = data.jobs.filter((job) => pointInGeometry(job.location.longitude, job.location.latitude, cell.geometry));
    return <aside className="map-detail-drawer"><header><div><span className="eyebrow">Selected 100 m cell</span><h2>{temperature.toFixed(1)}°C apparent</h2><span>{String(hour).padStart(2, "0")}:00 local · {jobs.length} jobs located here</span></div><button type="button" onClick={onClose} aria-label="Close details">×</button></header><div className="map-drawer-scroll"><dl><div><dt>Cell</dt><dd>{cell.cell_id}</dd></div><div><dt>15:00 field</dt><dd>{cell.temperature_c_1500.toFixed(1)}°C</dd></div><div><dt>Source</dt><dd>{cell.source}</dd></div><div><dt>Method</dt><dd>Hourly site apparent temperature plus this cell&apos;s difference from the 15:00 field mean.</dd></div></dl><section className="cell-jobs"><div><span className="eyebrow">Operations in this cell</span><strong>{jobs.filter((job) => overlapsHour(scheduleByJob.get(job.job_id), hour)).length} ongoing now</strong></div>{jobs.length ? jobs.map((job) => { const entry = scheduleByJob.get(job.job_id); const active = overlapsHour(entry, hour); const earlier = entry ? minuteOfDay(entry.end) <= hour * 60 : false; return <article className={active ? "active" : ""} key={job.job_id}><i /><div><strong>{job.name}</strong><span>{crewById.get(entry?.crew_id || job.assigned_crew_id)?.name || "Unassigned"} · {entry ? `${timeLabel(entry.start)}–${timeLabel(entry.end)}` : timeLabel(job.original_start)}</span><small>{active ? "Ongoing" : earlier ? "Earlier today" : "Upcoming"} · {job.workload.replace("_", " ")} workload{entry?.screening_score ? ` · score ${entry.screening_score}` : ""}</small></div></article>; }) : <p>No generated jobs are located inside this cell.</p>}</section><div className="drawer-limit"><strong>Estimate, not a sensor</strong><p>This cell is a HeatShift hourly reconstruction. It is not a building, worker or wearable measurement.</p></div></div></aside>;
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
  if (!open || !state) return null;
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { await onCreate({ name, state_code: state.code, site_type: siteType, operation_date: operationDate, geometry: { type: "coordinates", longitude: Number(longitude), latitude: Number(latitude), radius_m: Number(radius) } }); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Site could not be created."); } finally { setBusy(false); } };
  return <div className="walkthrough-backdrop" role="dialog" aria-modal="true" aria-label="Create daily operation site"><form className="create-site-card daily-create-card" onSubmit={submit}><button type="button" className="walkthrough-close" onClick={onClose} aria-label="Close">×</button><span className="eyebrow">New site · {state.name}</span><h2>Choose the operation location</h2><p>Tip: double-clicking the map fills these coordinates. New-site weather remains explicitly simulated in this local milestone.</p><label><span>Site name</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label><label><span>Operation type</span><input value={siteType} onChange={(event) => setSiteType(event.target.value)} required /></label><div className="field-pair"><label><span>Longitude</span><input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} required /></label><label><span>Latitude</span><input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} required /></label></div><div className="field-pair"><label><span>Site radius · metres</span><input type="number" min="100" max="5000" value={radius} onChange={(event) => setRadius(event.target.value)} required /></label><label><span>Simulation date</span><input type="date" min="2019-01-01" max={new Date().toISOString().slice(0, 10)} value={operationDate} onChange={(event) => setOperationDate(event.target.value)} required /></label></div>{error && <p className="dialog-error" role="alert">{error}</p>}<button className="create-site-submit" type="submit" disabled={busy}>{busy ? "Creating…" : "Create site"}</button></form></div>;
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
  const stateSites = useMemo(() => allSites.filter((site) => site.state_code === stateCode), [allSites, stateCode]);
  const currentState = states.find((state) => state.code === stateCode);
  const schedule = useMemo(() => data?.analysis ? data.analysis[planLayer] : originalSchedule(data?.jobs || []), [data, planLayer]);
  const cards = useMemo(() => data?.analysis ? metricCards(data.analysis) : [], [data?.analysis]);
  const activeCount = schedule.filter((entry) => overlapsHour(entry, hour)).length;

  const loadSite = async (activeSession: AuthSession, siteId: string) => {
    const workspace = await dailyApi.site(activeSession, siteId);
    setData(workspace);
    setStateCode(workspace.site.state_code);
    setPlanLayer(workspace.analysis ? "heatshift" : "original");
    setDrawer(null);
    setAllSites((items) => items.map((site) => site.site_id === workspace.site.site_id ? workspace.site : site));
  };
  useEffect(() => { let cancelled = false; void (async () => { try { const active = await getAnonymousSession(); const [stateList, sites] = await Promise.all([dailyApi.states(active), dailyApi.sites(active)]); if (cancelled) return; setSession(active); setStates(stateList); setAllSites(sites); } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : "The daily console could not be loaded."); } finally { if (!cancelled) setBusy(null); } })(); return () => { cancelled = true; }; }, []);
  const chooseState = (code: string) => { setStateCode(code); setData(null); setDrawer(null); setPanelOpen(false); };
  const chooseSite = async (siteId: string) => { if (!session) return; setBusy("loading"); setError(null); try { await loadSite(session, siteId); setPanelOpen(false); } catch (caught) { setError(caught instanceof Error ? caught.message : "Site could not be loaded."); } finally { setBusy(null); } };
  const generate = async () => { if (!session || !data) return; setBusy("generating"); setError(null); try { const workspace = await dailyApi.generate(session, data.site.site_id, simulation); setData(workspace); setPlanLayer("original"); setDrawer(null); setAllSites((items) => items.map((site) => site.site_id === workspace.site.site_id ? workspace.site : site)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Simulation could not be generated."); } finally { setBusy(null); } };
  const analyze = async () => { if (!session || !data) return; setBusy("analyzing"); setError(null); try { const analysis = await dailyApi.analyze(session, data.site.site_id); const workspace = { ...data, analysis, site: { ...data.site, workflow_stage: "analyzed" as const } }; setData(workspace); setPlanLayer("heatshift"); setAllSites((items) => items.map((site) => site.site_id === workspace.site.site_id ? workspace.site : site)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Analysis could not be completed."); } finally { setBusy(null); } };
  const createSite = async (payload: Record<string, unknown>) => { if (!session) return; const site = await dailyApi.createSite(session, payload); setAllSites(await dailyApi.sites(session)); await loadSite(session, site.site_id); };
  const removeSite = async () => { if (!session || !data || data.site.curated || !window.confirm(`Delete ${data.site.name}?`)) return; await dailyApi.deleteSite(session, data.site.site_id); setAllSites(await dailyApi.sites(session)); setData(null); setDrawer(null); };
  const selectedMetric = drawer?.kind === "metric" ? cards.find((card) => card.key === drawer.key) || null : null;

  if (busy === "loading" && !session) return <div className="weekly-initializing"><div className="loading-orbit"><i /><i /><i /></div><h1>Preparing the operations map</h1><p>Loading your sites and daily evidence.</p></div>;
  return <>
    <div className="weekly-toolbar daily-toolbar map-console-toolbar"><label><span>State</span><select value={stateCode} onChange={(event) => chooseState(event.target.value)}>{states.map((state) => <option value={state.code} key={state.code}>{state.name}</option>)}</select></label><div className="toolbar-source"><span className={`daily-workflow-pill stage-${data?.site.workflow_stage || "empty"}`}><i />{data ? workflowLabel(data.site) : `${stateSites.length} site${stateSites.length === 1 ? "" : "s"} on map`}</span><small>{data ? evidenceLabel(data.site) : "Select a marker or site tab"}</small></div><button className="map-panel-toggle" type="button" onClick={() => setPanelOpen((value) => !value)}>Setup & sites</button><div className="toolbar-actions"><button type="button" onClick={() => { setMapPoint(null); setCreateOpen(true); }}>+ Create site</button></div></div>
    <div className="map-console-shell"><aside className={`map-console-sidebar${panelOpen ? " open" : ""}`}><div className="weekly-sidebar-title"><div><span className="eyebrow">Daily operation</span><h2>Build and analyze</h2></div><button className="map-panel-close" type="button" onClick={() => setPanelOpen(false)} aria-label="Close setup panel">×</button></div><div className="daily-side-scroll"><section><span className="daily-side-label">Sites in {stateCode}</span><div className="weekly-list">{stateSites.length ? stateSites.map((site) => <button className={`site-list-card${data?.site.site_id === site.site_id ? " active" : ""}`} type="button" key={site.site_id} onClick={() => void chooseSite(site.site_id)}><span className="site-list-icon">⌖</span><span><strong>{site.name}</strong><small>{site.site_type}</small><em className="daily-card-status">{workflowLabel(site)}</em></span></button>) : <div className="weekly-empty"><strong>No sites yet</strong><p>Double-click anywhere inside the state or create one with coordinates.</p></div>}</div></section>
      {data ? <><section className="daily-flow"><span className="daily-side-label">Three-step flow</span><ol><li className="complete"><b>1</b><span><strong>Site selected</strong><small>{data.site.name}</small></span></li><li className={data.simulation ? "complete" : ""}><b>2</b><span><strong>Generate simulation</strong><small>Crews, jobs and submitted schedule</small></span></li><li className={data.analysis ? "complete" : ""}><b>3</b><span><strong>Run analysis</strong><small>Weather + risk + optimization</small></span></li></ol></section><section className="daily-simulation-controls"><span className="daily-side-label">Simulation scale</span><label>Random seed<input type="number" min="0" value={simulation.seed} onChange={(event) => setSimulation({ ...simulation, seed: Number(event.target.value) })} /></label><label>Crews<select value={simulation.crew_count} onChange={(event) => setSimulation({ ...simulation, crew_count: Number(event.target.value) })}>{[6, 8, 10, 12].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label>Jobs per crew<select value={simulation.jobs_per_crew} onChange={(event) => setSimulation({ ...simulation, jobs_per_crew: Number(event.target.value) })}>{[3, 4, 5, 6].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><button className="daily-primary-action" type="button" onClick={() => void generate()} disabled={Boolean(busy)}>{busy === "generating" ? "Generating operation…" : data.simulation ? "Generate a new simulation" : "Generate simulation"}</button><button className="daily-analysis-action" type="button" onClick={() => void analyze()} disabled={Boolean(busy) || !data.simulation}>{busy === "analyzing" ? "Running analysis…" : "Run HeatShift analysis"}</button>{data.simulation && <p>{data.simulation.worker_count} workers · {data.simulation.job_count} jobs · seed {data.simulation.seed}<br />{data.simulation.generation_mode === "ai_enriched_stochastic" ? "AI-enriched names + seeded operations" : "Seeded stochastic operations · AI fallback"}</p>}</section>{!data.site.curated && <button className="daily-delete" type="button" onClick={() => void removeSite()}>Delete this local site</button>}</> : <section className="sidebar-map-hint"><strong>Start on the map</strong><p>Choose a site tab or marker. The map will zoom into its thermal cells automatically.</p></section>}
      </div><div className="weekly-sidebar-note"><strong>Real conditions and fictional work stay separate.</strong><p>Built-in sites use cached FortyGuard evidence. New-site weather and all generated operations are clearly labeled.</p></div></aside>
      <main className="map-console-main"><section className="map-workspace">
        <DailyMap stateCode={stateCode} sites={stateSites} selectedSite={data?.site || null} evidence={data?.evidence || null} hour={hour} jobs={data?.jobs || []} schedule={schedule} selectedCellId={drawer?.kind === "cell" ? drawer.key : null} onSelectSite={(id) => void chooseSite(id)} onSelectCell={(cell: CellSelection) => setDrawer({ kind: "cell", key: cell.id })} onMapPoint={(longitude, latitude) => { setMapPoint({ longitude, latitude }); setCreateOpen(true); }} />
        <div className="map-site-tabs" role="tablist" aria-label={`${currentState?.name || stateCode} sites`}><button type="button" role="tab" aria-selected={!data} onClick={() => { setData(null); setDrawer(null); }}>All sites <b>{stateSites.length}</b></button>{stateSites.map((site) => <button type="button" role="tab" aria-selected={data?.site.site_id === site.site_id} key={site.site_id} onClick={() => void chooseSite(site.site_id)}><i className={`stage-${site.workflow_stage}`} />{site.name}</button>)}</div>
        {data?.evidence && <ConditionsHud evidence={data.evidence} hour={hour} activeCount={activeCount} planLayer={planLayer} onHour={setHour} onPlan={(layer) => setPlanLayer(data.analysis ? layer : "original")} />}
        <div className="map-legend"><span><i className="cool" />&lt;35°C</span><span><i className="warm" />35–38</span><span><i className="hot" />38–42</span><span><i className="critical" />42+</span><small>White border = ongoing work</small></div>
        {!data && <div className="map-stage-message overview"><span>⌖</span><strong>{currentState?.name || stateCode} operations</strong><p>Select a site marker or tab. Pan and zoom freely; double-click to place a new site.</p>{!stateSites.length && <button type="button" onClick={() => setCreateOpen(true)}>Create the first site</button>}</div>}
        {data && !data.simulation && <div className="map-stage-message"><span>2</span><strong>Generate this operation</strong><p>The site is ready. Set the scale in the left panel, then generate its crews, jobs and baseline schedule.</p></div>}
        {data?.simulation && !data.analysis && <div className="map-stage-message compact"><span>3</span><strong>Baseline ready</strong><p>{data.simulation.worker_count} workers · {data.simulation.job_count} jobs. Run the analysis to score and restructure the day.</p><button type="button" onClick={() => void analyze()}>Run HeatShift analysis</button></div>}
        {data?.analysis && <div className="map-metrics-dock" aria-label="Analysis results">{cards.map((card) => <button className={`${card.main ? "main " : ""}${card.tone || "neutral"}`} type="button" key={card.key} onClick={() => setDrawer({ kind: "metric", key: card.key })}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></button>)}<button className="briefing" type="button" onClick={() => setDrawer({ kind: "briefing", key: "briefing" })}><span>AI briefing</span><strong>Read</strong><small>grounded in these results</small></button></div>}
        {busy && <div className="map-progress"><i />{busy === "generating" ? "Generating a large daily operation…" : busy === "analyzing" ? "Scoring every task-hour and optimizing…" : "Loading site…"}</div>}
        {error && <div className="map-console-error" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
        {drawer && data && <MapDrawer drawer={drawer} data={data} hour={hour} schedule={schedule} metric={selectedMetric} onClose={() => setDrawer(null)} />}
      </section></main>
    </div>
    <CreateSiteDialog open={createOpen} state={currentState} point={mapPoint} onClose={() => { setCreateOpen(false); setMapPoint(null); }} onCreate={createSite} />
  </>;
}
