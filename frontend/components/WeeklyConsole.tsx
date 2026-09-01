"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import WeeklyMap from "@/components/WeeklyMap";
import type { BuildingEstimate } from "@/components/WeeklyMap";
import ProvisioningPanel from "@/components/ProvisioningPanel";
import { stateBoundary, stateCentre } from "@/lib/us-states";
import {
  getAnonymousSession,
  weeklyApi,
  type AuthSession,
  type MetricExplanation,
  type ScheduleEntry,
  type SiteDay,
  type SiteWorkspace,
  type StateOption,
  type WeeklyAnalysis,
  type WeeklyCrew,
  type WeeklyJob,
  type WeeklySite,
  type WorkspaceState,
} from "@/lib/api";

type PanelTab = "sites" | "jobs" | "crews";
type PlanView = "original" | "heatshift" | "working";
type DrawerContext = { type: "metric"; key: string } | { type: "job"; id: string } | { type: "crew"; id: string } | { type: "building"; value: BuildingEstimate } | null;

const WALKTHROUGH = [
  ["Choose the portfolio", "Pick a state and site. The week remains global while the map changes."],
  ["Move through time", "Select a day, then scrub the hour to see conditions, cells and active work together."],
  ["Compare plans", "Original never changes. HeatShift is the deterministic proposal. Working is yours to edit."],
  ["Inspect the trade-off", "Open any metric to see its formula and inputs before asking the AI for plain-language context."],
  ["Make the call", "Apply one movement or the whole proposal, drag work, reassign eligible crews and keep residual controls visible."],
];

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function timeLabel(value: string, timezone?: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

function suggestedTimezone(stateCode: string, longitude: number, latitude: number) {
  if (stateCode === "AK") return "America/Anchorage";
  if (stateCode === "HI") return "Pacific/Honolulu";
  if (stateCode === "AZ") return "America/Phoenix";
  if (stateCode === "TX" && longitude < -103) return "America/Denver";
  if (stateCode === "FL" && longitude < -85) return "America/Chicago";
  if (["ND", "SD", "NE", "KS"].includes(stateCode) && longitude < -101) return "America/Denver";
  if (stateCode === "ID" && latitude > 45.7 && longitude < -114.3) return "America/Los_Angeles";
  if (stateCode === "OR" && longitude > -117.5) return "America/Boise";
  if (["KY", "TN"].includes(stateCode) && longitude < -85.6) return "America/Chicago";
  if (stateCode === "IN" && longitude < -87) return "America/Chicago";
  if (["CA", "NV", "OR", "WA"].includes(stateCode)) return "America/Los_Angeles";
  if (["CO", "ID", "MT", "NM", "UT", "WY"].includes(stateCode)) return "America/Denver";
  if (["AL", "AR", "IA", "IL", "KS", "LA", "MN", "MO", "MS", "ND", "NE", "OK", "SD", "TN", "TX", "WI"].includes(stateCode)) return "America/Chicago";
  return "America/New_York";
}

function zonedTimestamp(date: string, hour: number, timezone: string, minute = 0) {
  const guess = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute));
  const offset = represented - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

function localDateTimeValue(timestamp: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function localInputTimestamp(value: string, timezone: string) {
  const [date, clock] = value.split("T"); const [hour, minute] = clock.split(":").map(Number);
  return zonedTimestamp(date, hour, timezone, minute);
}

export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => /^https?:\/\//.test(url) ? url : ""}
    components={{ a: ({ children: label, ...props }) => <a {...props} target="_blank" rel="noreferrer">{label}</a> }}>{children}</ReactMarkdown>;
}

function StatusPill({ site }: { site: WeeklySite }) {
  const label = site.data_status === "ready" ? "FortyGuard cached" : site.data_status === "degraded" ? "Labeled demo fallback" : site.data_status.replace("_", " ");
  return <span className={`weekly-status status-${site.data_status}`}><i />{label}</span>;
}

function Sidebar({
  tab, onTab, sites, selectedSiteId, onSite, onDeleteSite, data, onRefresh, onMapJob, onDefer, session, mobileOpen, weekStart,
}: {
  tab: PanelTab; onTab: (tab: PanelTab) => void; sites: WeeklySite[]; selectedSiteId: string | null;
  onSite: (siteId: string) => void; onDeleteSite: (siteId: string) => Promise<void>; data: SiteWorkspace | null; onRefresh: () => Promise<void>;
  onMapJob: (jobId: string) => void; onDefer: (job: WeeklyJob) => Promise<void>; session: AuthSession; mobileOpen: boolean; weekStart: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await onRefresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Change could not be saved."); }
    finally { setBusy(false); }
  };
  const addCrew = () => data && mutate(() => weeklyApi.createCrew(session, data.site.site_id, {
    name: `Crew ${data.crews.length + 1}`, worker_count: 2, acclimatization_status: "acclimatized", ppe_level: "low", default_workload: "moderate",
  }));
  const addJob = () => {
    if (!data?.crews[0]) return;
    const date = data.days[0]?.date || weekStart;
    void mutate(() => weeklyApi.createJob(session, data.site.site_id, {
      name: `New job ${data.jobs.length + 1}`, location: data.site.centroid, duration_minutes: 60, workload: "moderate",
      original_start: zonedTimestamp(date, 10, data.site.timezone), earliest_start: zonedTimestamp(date, 6, data.site.timezone), latest_finish: zonedTimestamp(date, 18, data.site.timezone),
      assigned_crew_id: data.crews[0].crew_id, eligible_crew_ids: [data.crews[0].crew_id], dependencies: [], movable: true, shaded: false, status: "pending",
    }));
  };
  return <aside className={`weekly-sidebar${mobileOpen ? " mobile-open" : ""}`}>
    <div className="weekly-sidebar-title"><div><span className="eyebrow">Operation setup</span><h2>Manage the week</h2></div><span className="save-state"><i />{session.mode === "supabase" ? "Workspace saved" : "Local adapter"}</span></div>
    <div className="weekly-panel-tabs" role="tablist">
      {(["sites", "jobs", "crews"] as PanelTab[]).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => onTab(value)}>{value}<b>{value === "sites" ? sites.length : value === "jobs" ? data?.jobs.length || 0 : data?.crews.length || 0}</b></button>)}
    </div>
    <div className="weekly-panel-scroll">
      {tab === "sites" && <div className="weekly-list">
        {sites.length === 0 && <div className="weekly-empty"><strong>No sites in this state</strong><p>Create one by coordinates, circle or polygon.</p></div>}
        {sites.map((site) => <button className={`site-list-card${selectedSiteId === site.site_id ? " active" : ""}`} key={site.site_id} type="button" onClick={() => onSite(site.site_id)}>
          <span className="site-list-icon">⌖</span><span><strong>{site.name}</strong><small>{site.site_type}</small><StatusPill site={site} /></span>{site.thermal_burden !== null && <em>{site.thermal_burden.toFixed(0)}<small>°h</small></em>}
        </button>)}
        {data && <details className="operation-editor"><summary>Edit selected site</summary><div className="operation-editor-grid">
          <label>Name<input aria-label="Site name editor" defaultValue={data.site.name} disabled={busy} onBlur={(event) => { if (event.target.value !== data.site.name) void mutate(() => weeklyApi.patchSite(session, data.site.site_id, { name: event.target.value })); }} /></label>
          <label>Type<input aria-label="Site type editor" defaultValue={data.site.site_type} disabled={busy} onBlur={(event) => { if (event.target.value !== data.site.site_type) void mutate(() => weeklyApi.patchSite(session, data.site.site_id, { site_type: event.target.value })); }} /></label>
          <label>Time zone<input aria-label="Site timezone editor" defaultValue={data.site.timezone} disabled={busy} onBlur={(event) => { if (event.target.value !== data.site.timezone) void mutate(() => weeklyApi.patchSite(session, data.site.site_id, { timezone: event.target.value })); }} /></label>
          {!data.site.curated && <button type="button" className="danger-action" disabled={busy} onClick={() => { if (!window.confirm(`Delete ${data.site.name}? This removes its private crews, jobs and plans.`)) return; setBusy(true); setError(null); void onDeleteSite(data.site.site_id).catch((caught) => setError(caught instanceof Error ? caught.message : "Site could not be deleted.")).finally(() => setBusy(false)); }}>Delete private site</button>}
        </div></details>}
      </div>}
      {tab === "crews" && <div className="weekly-list">
        {data?.crews.map((crew) => <article className="operation-card" key={crew.crew_id} draggable onDragStart={(event) => event.dataTransfer.setData("text/crew-id", crew.crew_id)}>
          <button type="button" className="operation-card-main" onClick={() => onMapJob(crew.crew_id)}><span className="crew-avatar">{crew.name.slice(0, 2).toUpperCase()}</span><span><strong>{crew.name}</strong><small>{crew.worker_count} workers · {crew.ppe_level} PPE</small></span></button>
          <div className="operation-card-actions"><select aria-label={`${crew.name} acclimatization`} value={crew.acclimatization_status} disabled={busy} onChange={(event) => void mutate(() => weeklyApi.patchCrew(session, crew.site_id, crew.crew_id, { acclimatization_status: event.target.value }))}><option value="new">New</option><option value="returning">Returning</option><option value="acclimatized">Acclimatized</option></select><button type="button" disabled={busy} onClick={() => void mutate(() => weeklyApi.deleteCrew(session, crew.site_id, crew.crew_id))}>Delete</button></div>
          <details className="operation-editor"><summary>Edit crew inputs</summary><div className="operation-editor-grid">
            <label>Name<input aria-label={`${crew.name} name`} defaultValue={crew.name} disabled={busy} onBlur={(event) => { if (event.target.value !== crew.name) void mutate(() => weeklyApi.patchCrew(session, crew.site_id, crew.crew_id, { name: event.target.value })); }} /></label>
            <label>Workers<input aria-label={`${crew.name} workers`} type="number" min="1" max="100" defaultValue={crew.worker_count} disabled={busy} onBlur={(event) => { const value = Number(event.target.value); if (value !== crew.worker_count) void mutate(() => weeklyApi.patchCrew(session, crew.site_id, crew.crew_id, { worker_count: value })); }} /></label>
            <label>PPE<select aria-label={`${crew.name} PPE`} value={crew.ppe_level} disabled={busy} onChange={(event) => void mutate(() => weeklyApi.patchCrew(session, crew.site_id, crew.crew_id, { ppe_level: event.target.value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label>Default workload<select aria-label={`${crew.name} default workload`} value={crew.default_workload} disabled={busy} onChange={(event) => void mutate(() => weeklyApi.patchCrew(session, crew.site_id, crew.crew_id, { default_workload: event.target.value }))}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
          </div></details>
        </article>)}
        <button className="weekly-add" type="button" onClick={addCrew} disabled={busy || !data}>+ Add crew</button>
      </div>}
      {tab === "jobs" && <div className="weekly-list">
        {data?.jobs.map((job) => <article className="operation-card" key={job.job_id}>
          <button type="button" className="operation-card-main" onClick={() => onMapJob(job.job_id)}><span className={`job-dot status-${job.status}`} /><span><strong>{job.name}</strong><small>{job.duration_minutes} min · {job.workload.replace("_", " ")}</small></span></button>
          <div className="operation-card-actions"><select aria-label={`${job.name} status`} value={job.status} disabled={busy || job.status === "completed"} onChange={(event) => void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { status: event.target.value }))}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="deferred">Deferred</option><option value="cancelled">Cancelled</option></select><button type="button" disabled={busy || job.status !== "pending" || job.latest_finish.slice(0, 10) <= job.original_start.slice(0, 10)} onClick={() => void mutate(() => onDefer(job))}>Next day</button><button type="button" disabled={busy || job.status === "completed" || job.status === "in_progress"} onClick={() => void mutate(() => weeklyApi.deleteJob(session, job.site_id, job.job_id))}>Delete</button></div>
          <details className="operation-editor"><summary>Edit job inputs</summary><div className="operation-editor-grid">
            <label>Name<input aria-label={`${job.name} name`} defaultValue={job.name} disabled={busy || job.status === "completed" || job.status === "in_progress"} onBlur={(event) => { if (event.target.value !== job.name) void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { name: event.target.value })); }} /></label>
            <label>Duration (minutes)<input aria-label={`${job.name} duration`} type="number" min="30" max="720" step="30" defaultValue={job.duration_minutes} disabled={busy || job.status === "completed" || job.status === "in_progress"} onBlur={(event) => { const value = Number(event.target.value); if (value !== job.duration_minutes) void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { duration_minutes: value })); }} /></label>
            <label>Workload<select aria-label={`${job.name} workload`} value={job.workload} disabled={busy || job.status === "completed" || job.status === "in_progress"} onChange={(event) => void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { workload: event.target.value }))}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
            <label>Assigned crew<select aria-label={`${job.name} assigned crew`} value={job.assigned_crew_id} disabled={busy || job.status === "completed" || job.status === "in_progress"} onChange={(event) => void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { assigned_crew_id: event.target.value, eligible_crew_ids: Array.from(new Set([...job.eligible_crew_ids, event.target.value])) }))}>{data.crews.map((crew) => <option key={crew.crew_id} value={crew.crew_id}>{crew.name}</option>)}</select></label>
            <label>Original start<input aria-label={`${job.name} original start`} type="datetime-local" step="1800" defaultValue={localDateTimeValue(job.original_start, data.site.timezone)} disabled={busy || job.status === "completed" || job.status === "in_progress"} onBlur={(event) => void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { original_start: localInputTimestamp(event.target.value, data.site.timezone) }))} /></label>
            <label>Earliest start<input aria-label={`${job.name} earliest start`} type="datetime-local" step="1800" defaultValue={localDateTimeValue(job.earliest_start, data.site.timezone)} disabled={busy || job.status === "completed" || job.status === "in_progress"} onBlur={(event) => void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { earliest_start: localInputTimestamp(event.target.value, data.site.timezone) }))} /></label>
            <label>Latest finish<input aria-label={`${job.name} latest finish`} type="datetime-local" step="1800" defaultValue={localDateTimeValue(job.latest_finish, data.site.timezone)} disabled={busy || job.status === "completed" || job.status === "in_progress"} onBlur={(event) => void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { latest_finish: localInputTimestamp(event.target.value, data.site.timezone) }))} /></label>
            <fieldset><legend>Eligible crews</legend>{data.crews.map((crew) => <label className="check-row" key={crew.crew_id}><input type="checkbox" checked={job.eligible_crew_ids.includes(crew.crew_id)} disabled={busy || job.status === "completed" || job.status === "in_progress" || crew.crew_id === job.assigned_crew_id} onChange={(event) => { const eligible = event.target.checked ? [...job.eligible_crew_ids, crew.crew_id] : job.eligible_crew_ids.filter((id) => id !== crew.crew_id); void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { eligible_crew_ids: Array.from(new Set(eligible)) })); }} />{crew.name}</label>)}</fieldset>
            <fieldset><legend>Constraints</legend><label className="check-row"><input type="checkbox" checked={job.movable} disabled={busy || job.status === "completed" || job.status === "in_progress"} onChange={(event) => void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { movable: event.target.checked }))} />Movable</label><label className="check-row"><input type="checkbox" checked={job.shaded} disabled={busy || job.status === "completed" || job.status === "in_progress"} onChange={(event) => void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { shaded: event.target.checked }))} />Shaded</label></fieldset>
            <fieldset><legend>Must follow</legend>{data.jobs.filter((candidate) => candidate.job_id !== job.job_id).map((candidate) => <label className="check-row" key={candidate.job_id}><input type="checkbox" checked={job.dependencies.includes(candidate.job_id)} disabled={busy || job.status === "completed" || job.status === "in_progress"} onChange={(event) => { const dependencies = event.target.checked ? [...job.dependencies, candidate.job_id] : job.dependencies.filter((id) => id !== candidate.job_id); void mutate(() => weeklyApi.patchJob(session, job.site_id, job.job_id, { dependencies: Array.from(new Set(dependencies)) })); }} />{candidate.name}</label>)}</fieldset>
          </div></details>
        </article>)}
        <button className="weekly-add" type="button" onClick={addJob} disabled={busy || !data?.crews.length}>+ Add job</button>
      </div>}
    </div>
    {error && <p className="weekly-sidebar-error" role="alert">{error}</p>}
    <div className="weekly-sidebar-note"><strong>Real conditions. Fictional operation.</strong><p>Environmental source and derivation are labeled on every site and metric.</p></div>
  </aside>;
}

function ConditionsChart({ day, hour }: { day: SiteDay; hour: number }) {
  const values = day.conditions.map((item) => item.apparent_temperature_c);
  const minimum = Math.min(...values) - 1;
  const maximum = Math.max(...values) + 1;
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 700},${150 - ((value - minimum) / (maximum - minimum)) * 120}`).join(" ");
  const selected = day.conditions.find((item) => Number(item.timestamp.slice(11, 13)) === hour) || day.conditions[0];
  return <section className="conditions-chart-card">
    <div className="conditions-chart-head"><div><span className="eyebrow">Hourly site conditions</span><h3>{selected.apparent_temperature_c.toFixed(1)}°C apparent</h3></div><div><span>{selected.wet_bulb_temperature_c.toFixed(1)}° wet bulb</span><span>{selected.relative_humidity_percent.toFixed(0)}% humidity</span><span>{selected.solar_irradiance_ghi_wm2.toFixed(0)} W/m² daily-average clear-sky GHI</span></div></div>
    <svg viewBox="0 0 700 170" role="img" aria-label="Hourly apparent temperature time series"><path d="M0 150H700" /><polyline points={points} /><line x1={(hour / 23) * 700} x2={(hour / 23) * 700} y1="10" y2="150" /><text x={Math.min(650, (hour / 23) * 700 + 8)} y="22">{String(hour).padStart(2, "0")}:00</text></svg>
    <div className="conditions-axis"><span>00:00</span><span>{day.conditions[0]?.source === "demonstration" ? "Labeled demonstration profile" : "FortyGuard hourly evidence"}</span><span>23:00</span></div>
  </section>;
}

function JobStatusBoard({ data, analysis, day, hour, onJob }: { data: SiteWorkspace; analysis: WeeklyAnalysis | null; day: string; hour: number; onJob: (jobId: string) => void }) {
  const entries = analysis?.working || [];
  const groups: Record<string, WeeklyJob[]> = { "Scheduled now": [], Upcoming: [], "Past due": [], Completed: [], Cancelled: [], Deferred: [] };
  data.jobs.forEach((job) => {
    const entry = entries.find((item) => item.job_id === job.job_id);
    const scheduledDay = entry?.start.slice(0, 10) || job.original_start.slice(0, 10);
    if (scheduledDay !== day) return;
    if (job.status === "completed") groups.Completed.push(job);
    else if (job.status === "cancelled") groups.Cancelled.push(job);
    else if (job.status === "deferred") groups.Deferred.push(job);
    else {
      const startMinutes = Number((entry?.start || job.original_start).slice(11, 13)) * 60 + Number((entry?.start || job.original_start).slice(14, 16));
      const endMinutes = startMinutes + job.duration_minutes;
      const now = hour * 60;
      if (job.status === "in_progress" || (now >= startMinutes && now < endMinutes)) groups["Scheduled now"].push(job);
      else if (now >= endMinutes) groups["Past due"].push(job);
      else groups.Upcoming.push(job);
    }
  });
  return <section className="job-status-board" aria-label="Jobs by current operational status">{Object.entries(groups).map(([label, jobs]) => <div key={label}><span>{label}</span><strong>{jobs.length}</strong>{jobs.slice(0, 2).map((job) => <button type="button" key={job.job_id} onClick={() => onJob(job.job_id)}>{job.name}</button>)}</div>)}</section>;
}

function Metrics({ analysis, onMetric }: { analysis: WeeklyAnalysis; onMetric: (key: string) => void }) {
  const metrics = analysis.metrics;
  const heatshift = analysis.plan_metrics?.heatshift || metrics;
  const working = analysis.plan_metrics?.working || metrics;
  const metricCards = [
    ["thermal_burden", "Site Thermal Burden", metrics.site_thermal_burden_degree_hours.toFixed(1), "degree-hours > 35°C"],
    ["crew_load", "Crew Exposure Load", `${metrics.original_crew_exposure_load.toFixed(1)} → ${heatshift.proposed_crew_exposure_load.toFixed(1)} → ${working.proposed_crew_exposure_load.toFixed(1)}`, "Original → HeatShift → Working"],
    ["risk_reduction", "High-risk time avoided", `${heatshift.high_risk_hours_avoided.toFixed(1)} / ${working.high_risk_hours_avoided.toFixed(1)}`, "HeatShift / Working worker-hours"],
    ["disruption", "Plan disruption", `${heatshift.disruption.total_minutes_shifted} / ${working.disruption.total_minutes_shifted}`, "HeatShift / Working minutes shifted"],
  ];
  return <section className="weekly-metrics" aria-label="Weekly plan comparison metrics">{metricCards.map(([key, name, value, unit]) => <button type="button" key={key} onClick={() => onMetric(key)}><span>{name}<i>↗</i></span><strong>{value}</strong><small>{unit}</small></button>)}</section>;
}

function DayTimeline({ data, analysis, day, layer, onLayer, onMove, onAssign, onApplyOne, onUndo, onReset, canUndo }: {
  data: SiteWorkspace; analysis: WeeklyAnalysis; day: string; layer: PlanView; onLayer: (layer: PlanView) => void;
  onMove: (jobId: string, hour: number) => void; onAssign: (jobId: string, crewId: string) => void; onApplyOne: (jobId: string) => void; onUndo: () => void; onReset: () => void; canUndo: boolean;
}) {
  const entries = analysis[layer].filter((entry) => entry.start.slice(0, 10) === day);
  const jobById = new Map(data.jobs.map((job) => [job.job_id, job]));
  const crewById = new Map(data.crews.map((crew) => [crew.crew_id, crew]));
  return <section className="weekly-timeline-card">
    <div className="timeline-toolbar"><div><span className="eyebrow">Job and crew timeline</span><h3>{dateLabel(day)}</h3></div><div className="plan-switcher" role="tablist">{(["original", "heatshift", "working"] as PlanView[]).map((value) => <button type="button" role="tab" aria-selected={layer === value} onClick={() => onLayer(value)} key={value}>{value === "heatshift" ? "HeatShift" : value[0].toUpperCase() + value.slice(1)}</button>)}</div><div className="timeline-actions"><button type="button" onClick={onUndo} disabled={!canUndo}>Undo</button><button type="button" onClick={onReset}>Reset working</button></div></div>
    <div className="hour-ruler">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</span>)}</div>
    <div className="timeline-drop-grid">{Array.from({ length: 24 }, (_, hour) => <div key={hour} onDragOver={(event) => { if (layer === "working") event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); onMove(event.dataTransfer.getData("text/job-id"), hour); }} />)}</div>
    <div className="timeline-jobs">{entries.map((entry) => {
      const job = jobById.get(entry.job_id); const crew = crewById.get(entry.crew_id); if (!job) return null;
      const start = new Date(entry.start); const localHour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: data.site.timezone }).format(start)) % 24;
      const left = localHour / 24 * 100; const width = Math.max(4, job.duration_minutes / 1440 * 100);
      const proposed = analysis.heatshift.find((item) => item.job_id === job.job_id);
      const original = analysis.original.find((item) => item.job_id === job.job_id);
      return <article draggable={layer === "working" && job.movable && job.status === "pending"} onDragStart={(event) => event.dataTransfer.setData("text/job-id", job.job_id)} onDragOver={(event) => { if (layer === "working" && event.dataTransfer.types.includes("text/crew-id")) event.preventDefault(); }} onDrop={(event) => { const crewId = event.dataTransfer.getData("text/crew-id"); if (crewId) { event.preventDefault(); event.stopPropagation(); onAssign(job.job_id, crewId); } }} key={job.job_id} style={{ left: `${left}%`, width: `${width}%` }} className={`timeline-job risk-${entry.screening_score >= 70 ? "critical" : entry.screening_score >= 50 ? "high" : "low"}`}>
        <strong>{job.name}</strong><small>{timeLabel(entry.start, data.site.timezone)} · {crew?.name}</small><b>{entry.screening_score}</b>
        {layer === "working" && job.eligible_crew_ids.length > 1 && <select aria-label={`Assign crew to ${job.name}`} value={entry.crew_id} onChange={(event) => onAssign(job.job_id, event.target.value)}>{job.eligible_crew_ids.map((crewId) => <option value={crewId} key={crewId}>{crewById.get(crewId)?.name || crewId}</option>)}</select>}
        {layer === "original" && proposed?.start !== original?.start && <button type="button" onClick={() => onApplyOne(job.job_id)}>Apply HeatShift move</button>}
      </article>;
    })}</div>
    <div className="timeline-legend"><span><i className="risk-low" /> Below 50</span><span><i className="risk-high" /> 50–69</span><span><i className="risk-critical" /> 70+</span><span>{layer === "working" ? "Drag pending jobs to a new hour" : "Switch to Working to edit"}</span></div>
  </section>;
}

function Briefing({ analysis, onAsk }: { analysis: WeeklyAnalysis; onAsk: () => void }) {
  return <section className="weekly-briefing"><div className="briefing-side"><span>AI</span><strong>Operational brief</strong><small>{analysis.briefing_mode.replaceAll("_", " ")}</small></div><div className="briefing-markdown"><Markdown>{analysis.briefing_markdown}</Markdown></div><button type="button" onClick={onAsk}>Ask about this result <span>↗</span></button></section>;
}

function ContextDrawer({ context, data, analysis, onClose, session }: { context: DrawerContext; data: SiteWorkspace; analysis: WeeklyAnalysis; onClose: () => void; session: AuthSession }) {
  const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState<string | null>(null); const [history, setQuestionHistory] = useState<Array<{ question: string; answer: string }>>([]); const [busy, setBusy] = useState(false);
  const historyKey = `heatshift-qa:${analysis.analysis_id}`;
  useEffect(() => { try { setQuestionHistory(JSON.parse(window.sessionStorage.getItem(historyKey) || "[]")); } catch { setQuestionHistory([]); } }, [historyKey]);
  useEffect(() => { setAnswer(null); setQuestion(""); }, [context]);
  if (!context) return null;
  const metric: MetricExplanation | undefined = context.type === "metric" ? analysis.explanations[context.key] : undefined;
  const job = context.type === "job" ? data.jobs.find((item) => item.job_id === context.id) : undefined;
  const crew = context.type === "crew" ? data.crews.find((item) => item.crew_id === context.id) : undefined;
  const building = context.type === "building" ? context.value : undefined;
  const title = metric?.metric || job?.name || crew?.name || (building ? building.kind === "cell" ? "Thermal cell estimate" : "Building estimate" : "Selected result");
  const ask = async (event: FormEvent) => { event.preventDefault(); if (!question.trim()) return; setBusy(true); try { const asked = question.trim(); const response = await weeklyApi.ask(session, analysis.analysis_id, asked, context); setAnswer(response.answer_markdown); const revised = [...history, { question: asked, answer: response.answer_markdown }].slice(-20); setQuestionHistory(revised); window.sessionStorage.setItem(historyKey, JSON.stringify(revised)); setQuestion(""); } catch (caught) { setAnswer(caught instanceof Error ? caught.message : "The explanation is unavailable."); } finally { setBusy(false); } };
  return <aside className="context-drawer" aria-label="Result details"><div className="drawer-head"><div><span className="eyebrow">Deterministic inspector</span><h2>{title}</h2></div><button type="button" aria-label="Close inspector" onClick={onClose}>×</button></div>
    <div className="drawer-body">
      {metric && <><p className="drawer-lead">{metric.definition}</p><dl><div><dt>Formula</dt><dd><code>{metric.formula}</code></dd></div><div><dt>Plan comparison</dt><dd>{metric.comparison}</dd></div><div><dt>Source</dt><dd>{metric.source}</dd></div><div><dt>Inputs</dt><dd><pre>{JSON.stringify(metric.inputs, null, 2)}</pre></dd></div></dl><div className="drawer-limit"><strong>Limits</strong>{metric.limitations.map((item) => <p key={item}>{item}</p>)}</div></>}
      {job && <dl><div><dt>Status</dt><dd>{job.status.replace("_", " ")}</dd></div><div><dt>Window</dt><dd>{dateLabel(job.earliest_start.slice(0, 10))} {timeLabel(job.earliest_start, data.site.timezone)} → {dateLabel(job.latest_finish.slice(0, 10))} {timeLabel(job.latest_finish, data.site.timezone)}</dd></div><div><dt>Work</dt><dd>{job.duration_minutes} minutes · {job.workload.replace("_", " ")} · {job.shaded ? "shade" : "unshaded"}</dd></div><div><dt>Mobility</dt><dd>{job.movable ? "May move inside its window" : "Fixed in place"}</dd></div></dl>}
      {crew && <dl><div><dt>Workers</dt><dd>{crew.worker_count}</dd></div><div><dt>Acclimatization</dt><dd>{crew.acclimatization_status}</dd></div><div><dt>PPE burden</dt><dd>{crew.ppe_level}</dd></div><div><dt>Default workload</dt><dd>{crew.default_workload.replace("_", " ")}</dd></div></dl>}
      {building && <><p className="drawer-lead">{building.kind === "cell" ? "This hourly cell value is reconstructed from the FortyGuard 15:00 spatial difference and the site’s hourly apparent-temperature curve." : "This is not a building sensor reading. HeatShift estimates the clicked building point from its intersecting FortyGuard cell (or the nearest mapped cell at an edge) and the disclosed hourly interpolation."}</p><dl><div><dt>Estimated apparent temperature</dt><dd>{building.apparentTemperatureC === null ? "No evidence for this hour" : `${building.apparentTemperatureC.toFixed(1)}°C`}</dd></div><div><dt>Map coordinates</dt><dd>{building.latitude.toFixed(5)}, {building.longitude.toFixed(5)}</dd></div><div><dt>Authority</dt><dd>HeatShift-derived contextual estimate</dd></div></dl></>}
      <form className="drawer-ask" onSubmit={ask}><label htmlFor="context-question">Ask AI about this result</label><textarea id="context-question" maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Why did this move? What is still exposed?" /><button type="submit" disabled={busy || !question.trim()}>{busy ? "Checking facts…" : "Ask grounded AI"}</button></form>
      {answer && <div className="drawer-answer"><Markdown>{answer}</Markdown></div>}
      {history.length > 0 && <details className="drawer-history"><summary>Session Q&amp;A history · {history.length}</summary>{history.map((item, index) => <article key={`${item.question}-${index}`}><strong>{item.question}</strong><Markdown>{item.answer}</Markdown></article>)}</details>}
    </div>
  </aside>;
}

function Walkthrough({ open, onClose, onComplete }: { open: boolean; onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    setStep(0);
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // Opening the modal establishes one keyboard handler; callback identity changes must not reset the current step.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return <div className="walkthrough-backdrop" role="dialog" aria-modal="true" aria-label="HeatShift walkthrough"><section className="walkthrough-card"><button ref={closeButton} className="walkthrough-close" type="button" aria-label="Close walkthrough" onClick={onClose}>×</button><span className="eyebrow">Walkthrough · {step + 1} of {WALKTHROUGH.length}</span><div className="walkthrough-visual"><b>{String(step + 1).padStart(2, "0")}</b><i /><i /><i /></div><h2>{WALKTHROUGH[step][0]}</h2><p>{WALKTHROUGH[step][1]}</p><div className="walkthrough-progress">{WALKTHROUGH.map((_, index) => <i className={index <= step ? "active" : ""} key={index} />)}</div><div className="walkthrough-actions"><button type="button" onClick={onClose}>Skip</button>{step < WALKTHROUGH.length - 1 ? <button type="button" onClick={() => setStep((value) => value + 1)}>Next</button> : <button type="button" onClick={onComplete}>Open the console</button>}</div></section></div>;
}

function nestedCoordinates(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") return [[value[0], value[1]]];
  return value.flatMap(nestedCoordinates);
}

export function SiteGeometrySketch({ stateCode, mode, longitude, latitude, radius, points, onCentre, onPoints }: {
  stateCode: string; mode: "coordinates" | "circle" | "polygon"; longitude: number; latitude: number; radius: number;
  points: number[][]; onCentre: (longitude: number, latitude: number) => void; onPoints: (points: number[][]) => void;
}) {
  const boundary = useMemo(() => stateBoundary(stateCode), [stateCode]);
  const all = boundary.features.flatMap((feature) => nestedCoordinates("coordinates" in feature.geometry ? feature.geometry.coordinates : []));
  const west = Math.min(...all.map((item) => item[0])); const east = Math.max(...all.map((item) => item[0]));
  const south = Math.min(...all.map((item) => item[1])); const north = Math.max(...all.map((item) => item[1]));
  const project = (lon: number, lat: number) => [20 + (lon - west) / Math.max(east - west, .001) * 520, 270 - 20 - (lat - south) / Math.max(north - south, .001) * 230];
  const pathFor = (coordinates: unknown) => {
    const polygons = Array.isArray(coordinates) && Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0]) && typeof coordinates[0][0][0] === "number" ? [coordinates] : coordinates as unknown[];
    return (polygons || []).map((polygon) => (polygon as number[][][]).map((ring) => ring.map(([lon, lat], index) => { const [x, y] = project(lon, lat); return `${index ? "L" : "M"}${x},${y}`; }).join("") + "Z").join(" ")).join(" ");
  };
  const screenPoints = points.map(([lon, lat]) => project(lon, lat).join(",")).join(" ");
  const [cx, cy] = project(longitude, latitude);
  const circleRadius = Math.max(4, radius / 111_320 / Math.max(east - west, .001) * 520);
  return <div className="geometry-sketch"><svg viewBox="0 0 560 270" role="img" aria-label={`Draw a ${mode} inside ${stateCode}`} tabIndex={0} onClick={(event) => {
    const rect = event.currentTarget.getBoundingClientRect(); const lon = west + (event.clientX - rect.left) / rect.width * (east - west); const lat = north - (event.clientY - rect.top) / rect.height * (north - south);
    if (mode === "polygon") onPoints([...points, [lon, lat]]); else onCentre(lon, lat);
  }}>
    <rect width="560" height="270" />
    {boundary.features.map((feature, index) => <path key={index} d={pathFor("coordinates" in feature.geometry ? feature.geometry.coordinates : [])} />)}
    {mode === "polygon" && <><polyline points={screenPoints} /><g>{points.map(([lon, lat], index) => { const [x, y] = project(lon, lat); return <circle key={index} cx={x} cy={y} r="5"><title>Vertex {index + 1}</title></circle>; })}</g></>}
    {mode !== "polygon" && Number.isFinite(cx) && Number.isFinite(cy) && <><circle className="geometry-radius" cx={cx} cy={cy} r={mode === "circle" ? circleRadius : 7} /><circle className="geometry-centre" cx={cx} cy={cy} r="5" /></>}
  </svg><div><span>{mode === "polygon" ? `${points.length} vertices · click the map to add` : "Click the map to position the centre"}</span>{mode === "polygon" && <><button type="button" onClick={() => onPoints(points.slice(0, -1))} disabled={!points.length}>Undo point</button><button type="button" onClick={() => onPoints([])} disabled={!points.length}>Clear</button></>}</div></div>;
}

function CreateSiteDialog({ open, stateCode, point, onClose, onCreate }: { open: boolean; stateCode: string; point: { longitude: number; latitude: number } | null; onClose: () => void; onCreate: (payload: Record<string, unknown>) => Promise<void> }) {
  const [mode, setMode] = useState<"coordinates" | "circle" | "polygon">("circle"); const [name, setName] = useState("New outdoor site"); const [longitude, setLongitude] = useState(""); const [latitude, setLatitude] = useState(""); const [radius, setRadius] = useState("500"); const [points, setPoints] = useState<number[][]>([]); const [timezone, setTimezone] = useState("America/New_York"); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { const centre = point || stateCentre(stateCode); setLongitude(centre.longitude.toFixed(6)); setLatitude(centre.latitude.toFixed(6)); setTimezone(suggestedTimezone(stateCode, centre.longitude, centre.latitude)); setPoints([]); }, [point, stateCode, open]);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // Opening the modal establishes one keyboard handler; callback identity changes must not refocus on every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const setCentre = (lon: number, lat: number) => { setLongitude(lon.toFixed(6)); setLatitude(lat.toFixed(6)); setTimezone(suggestedTimezone(stateCode, lon, lat)); };
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try {
    if (mode === "polygon" && points.length < 3) throw new Error("Add at least three polygon vertices.");
    const ring = points.length ? [...points, points[0]] : [];
    const geometry = mode === "polygon" ? { type: "polygon", polygon: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] } } : { type: mode, longitude: Number(longitude), latitude: Number(latitude), radius_m: Number(radius) };
    await onCreate({ name, state_code: stateCode, site_type: "outdoor worksite", geometry, timezone }); onClose();
  } catch (caught) { setError(caught instanceof Error ? caught.message : "Site could not be created."); } finally { setBusy(false); } };
  return <div className="walkthrough-backdrop" role="dialog" aria-modal="true" aria-label="Create site"><form className="create-site-card create-site-wide" onSubmit={submit}><button ref={closeButton} className="walkthrough-close" type="button" aria-label="Close site creation" onClick={onClose}>×</button><span className="eyebrow">New site · {stateCode}</span><h2>Define the work area</h2><div className="creation-modes">{(["circle", "coordinates", "polygon"] as const).map((value) => <button type="button" aria-pressed={mode === value} key={value} onClick={() => setMode(value)}>{value}</button>)}</div><label><span>Site name</span><input aria-label="Site name" value={name} onChange={(event) => setName(event.target.value)} /></label><SiteGeometrySketch stateCode={stateCode} mode={mode} longitude={Number(longitude)} latitude={Number(latitude)} radius={Number(radius)} points={points} onCentre={setCentre} onPoints={setPoints} />{mode !== "polygon" && <><div className="field-pair"><label><span>Longitude</span><input aria-label="Longitude" type="number" step="any" value={longitude} onChange={(event) => setCentre(Number(event.target.value), Number(latitude))} required /></label><label><span>Latitude</span><input aria-label="Latitude" type="number" step="any" value={latitude} onChange={(event) => setCentre(Number(longitude), Number(event.target.value))} required /></label></div><label><span>Radius · metres</span><input aria-label="Radius in metres" type="number" min="50" max="5000" value={radius} onChange={(event) => setRadius(event.target.value)} /></label></>}<label><span>Time zone · confirm</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} required /></label><p>Maximum 10 mi² · 100m cells · the whole geometry must remain inside {stateCode}. The backend converts circles to 32-vertex GeoJSON and validates every boundary.</p>{error && <p className="dialog-error" role="alert">{error}</p>}<button className="create-site-submit" type="submit" disabled={busy}>{busy ? "Creating…" : "Create site"}</button></form></div>;
}

export default function WeeklyConsole() {
  const [session, setSession] = useState<AuthSession | null>(null); const [workspace, setWorkspace] = useState<WorkspaceState | null>(null); const [states, setStates] = useState<StateOption[]>([]); const [stateCode, setStateCode] = useState("AZ"); const [sites, setSites] = useState<WeeklySite[]>([]); const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null); const [data, setData] = useState<SiteWorkspace | null>(null); const [analysis, setAnalysis] = useState<WeeklyAnalysis | null>(null); const [dayIndex, setDayIndex] = useState(0); const [hour, setHour] = useState(15); const [tab, setTab] = useState<PanelTab>("sites"); const [layer, setLayer] = useState<PlanView>("working"); const [mapMode, setMapMode] = useState<"portfolio" | "site">("portfolio"); const [mobilePanelOpen, setMobilePanelOpen] = useState(false); const [drawer, setDrawer] = useState<DrawerContext>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [history, setHistory] = useState<ScheduleEntry[][]>([]); const [walkthrough, setWalkthrough] = useState(false); const [createSite, setCreateSite] = useState(false); const [mapPoint, setMapPoint] = useState<{ longitude: number; latitude: number } | null>(null);

  const loadSite = useCallback(async (activeSession: AuthSession, siteId: string) => {
    const siteData = await weeklyApi.site(activeSession, siteId); setData(siteData); setSelectedSiteId(siteId); setDayIndex(0); setHistory([]);
    if (siteData.days.length && siteData.crews.length && siteData.jobs.length) { const result = siteData.analysis || await weeklyApi.optimize(activeSession, siteId); setAnalysis(result); }
    else setAnalysis(null);
  }, []);
  const loadSites = useCallback(async (activeSession: AuthSession, code: string, preferred?: string | null) => {
    const nextSites = await weeklyApi.sites(activeSession, code); setSites(nextSites); const nextId = nextSites.some((site) => site.site_id === preferred) ? preferred : nextSites[0]?.site_id; if (nextId) await loadSite(activeSession, nextId); else { setSelectedSiteId(null); setData(null); setAnalysis(null); }
  }, [loadSite]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const active = await getAnonymousSession();
        const [workspaceState, stateList] = await Promise.all([weeklyApi.workspace(active), weeklyApi.states(active)]);
        if (cancelled) return;
        setSession(active); setWorkspace(workspaceState); setStates(stateList);
        await loadSites(active, "AZ");
        if (!cancelled) setWalkthrough(!workspaceState.walkthrough_completed);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "The weekly console could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadSites]);
  const refresh = useCallback(async () => { if (session && selectedSiteId) await loadSite(session, selectedSiteId); }, [session, selectedSiteId, loadSite]);
  const chooseState = async (code: string) => { if (!session) return; setStateCode(code); setMapMode("portfolio"); setLoading(true); setError(null); try { await loadSites(session, code); } catch (caught) { setError(caught instanceof Error ? caught.message : "State portfolio could not be loaded."); } finally { setLoading(false); } };
  const chooseWeek = async (value: string) => { if (!session || !workspace) return; setLoading(true); try { const revised = await weeklyApi.patchWorkspace(session, { week_start: value }); setWorkspace(revised); await loadSites(session, stateCode, selectedSiteId); } catch (caught) { setError(caught instanceof Error ? caught.message : "Week could not be changed."); } finally { setLoading(false); } };
  const currentDay = data?.days[dayIndex];
  const mapSite = useMemo<WeeklySite>(() => data?.site || {
    site_id: `empty-${stateCode}`, owner_id: null, name: `${states.find((item) => item.code === stateCode)?.name || stateCode} portfolio`, state_code: stateCode,
    site_type: "state portfolio", geometry: stateBoundary(stateCode) as WeeklySite["geometry"], centroid: stateCentre(stateCode), timezone: "America/New_York", curated: true,
    fictional_operation: true, data_status: "unavailable", evidence_week_start: null, source_label: "No selected site", thermal_burden: null,
  }, [data?.site, stateCode, states]);
  const applyWorking = async (entries: ScheduleEntry[]) => { if (!session || !data || !analysis) return; setHistory((items) => [...items, analysis.working]); try { const result = await weeklyApi.workingPlan(session, data.site.site_id, entries); setAnalysis(result); setData((value) => value ? { ...value, analysis: result } : value); setLayer("working"); setError(null); } catch (caught) { setHistory((items) => items.slice(0, -1)); setError(caught instanceof Error ? caught.message : "Working plan was rejected."); } };
  const moveJob = (jobId: string, targetHour: number) => { if (!analysis || !currentDay || !data) return; const entry = analysis.working.find((item) => item.job_id === jobId); const job = data.jobs.find((item) => item.job_id === jobId); if (!entry || !job) return; const offset = entry.start.match(/([+-]\d\d:\d\d|Z)$/)?.[1] || "Z"; const start = `${currentDay.date}T${String(targetHour).padStart(2, "0")}:00:00${offset}`; const end = new Date(new Date(start).getTime() + job.duration_minutes * 60_000).toISOString(); void applyWorking(analysis.working.map((item) => item.job_id === jobId ? { ...item, start, end } : item)); };
  const assignCrew = (jobId: string, crewId: string) => { if (!analysis) return; void applyWorking(analysis.working.map((item) => item.job_id === jobId ? { ...item, crew_id: crewId } : item)); };
  const deferJob = async (job: WeeklyJob) => { if (!session) return; await weeklyApi.patchJob(session, job.site_id, job.job_id, { status: "deferred" }); };
  const moveJobLocation = async (jobId: string, longitude: number, latitude: number) => { if (!session || !data) return; try { await weeklyApi.patchJob(session, data.site.site_id, jobId, { location: { longitude, latitude } }); await refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Job location was rejected."); await refresh(); } };
  const applyOne = (jobId: string) => { if (!analysis) return; const proposal = analysis.heatshift.find((item) => item.job_id === jobId); if (proposal) void applyWorking(analysis.working.map((item) => item.job_id === jobId ? { ...proposal, source: "working" } : item)); };
  const undo = () => { const previous = history.at(-1); if (!previous) return; setHistory((items) => items.slice(0, -1)); if (session && data) void weeklyApi.workingPlan(session, data.site.site_id, previous).then((result) => { setAnalysis(result); setData((value) => value ? { ...value, analysis: result } : value); }).catch((caught) => setError(caught instanceof Error ? caught.message : "Undo failed.")); };
  const openContext = (id: string) => { if (data?.jobs.some((job) => job.job_id === id)) setDrawer({ type: "job", id }); else if (data?.crews.some((crew) => crew.crew_id === id)) setDrawer({ type: "crew", id }); };
  const completeWalkthrough = async () => {
    setWalkthrough(false);
    if (!session) return;
    try { setWorkspace(await weeklyApi.patchWorkspace(session, { walkthrough_completed: true })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Walkthrough status could not be saved."); }
  };
  const createNewSite = async (payload: Record<string, unknown>) => { if (!session) return; const site = await weeklyApi.createSite(session, payload); await loadSites(session, stateCode, site.site_id); };
  const deleteSite = async (siteId: string) => { if (!session) return; await weeklyApi.deleteSite(session, siteId); await loadSites(session, stateCode); };
  const loadProvisionedSite = async (siteId: string) => { if (!session) return; setWorkspace(await weeklyApi.workspace(session)); await loadSites(session, stateCode, siteId); setMapMode("site"); };
  const addJobAtPoint = async (longitude: number, latitude: number) => {
    if (!session || !data?.crews[0] || !currentDay) return;
    const offset = data.jobs[0]?.original_start.match(/([+-]\d\d:\d\d|Z)$/)?.[1] || "Z";
    try {
      await weeklyApi.createJob(session, data.site.site_id, {
        name: `Map job ${data.jobs.length + 1}`, location: { longitude, latitude }, duration_minutes: 60, workload: "moderate",
        original_start: `${currentDay.date}T10:00:00${offset}`, earliest_start: `${currentDay.date}T06:00:00${offset}`, latest_finish: `${currentDay.date}T18:00:00${offset}`,
        assigned_crew_id: data.crews[0].crew_id, eligible_crew_ids: data.crews.map((crew) => crew.crew_id), dependencies: [], movable: true, shaded: false, status: "pending",
      });
      setTab("jobs"); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Job could not be placed."); }
  };

  if (loading && !data) return <div className="weekly-initializing"><div className="loading-orbit"><i /><i /><i /></div><h1>Opening the weekly operation</h1><p>Loading sites, jobs, crews and environmental evidence.</p></div>;
  return <>
    <div className="weekly-toolbar"><button className="mobile-panel-toggle" type="button" aria-expanded={mobilePanelOpen} onClick={() => setMobilePanelOpen((value) => !value)}>Manage</button><label><span>State</span><select value={stateCode} onChange={(event) => void chooseState(event.target.value)}>{states.map((state) => <option key={state.code} value={state.code}>{state.name}</option>)}</select></label><label><span>Week starts</span><input type="date" min="2019-01-01" max={new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)} value={workspace?.week_start || "2024-07-15"} onChange={(event) => void chooseWeek(event.target.value)} /></label><div className="toolbar-source">{data ? <StatusPill site={data.site} /> : <span>No selected site</span>}<small>{workspace?.live_site_weeks_remaining || 0} live site-week remaining</small></div><div className="toolbar-actions"><button type="button" onClick={() => setCreateSite(true)}>+ Create site</button><button type="button" onClick={() => setWalkthrough(true)}>Walkthrough</button></div></div>
    <div className="weekly-shell">{session && <Sidebar tab={tab} onTab={setTab} sites={sites} selectedSiteId={selectedSiteId} onSite={(siteId) => { setMapMode("site"); setMobilePanelOpen(false); void loadSite(session, siteId); }} onDeleteSite={deleteSite} data={data} onRefresh={refresh} onMapJob={openContext} onDefer={deferJob} session={session} mobileOpen={mobilePanelOpen} weekStart={workspace?.week_start || "2024-07-15"} />}
      <main className="weekly-main">{loading && <div className="weekly-progress"><i />Updating the operation…</div>}{error && <div className="weekly-error" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
        {!data && <div className="weekly-workspace"><section className="weekly-no-site compact"><span>⌖</span><div><h1>No site selected</h1><p>Create a site in {stateCode}, or switch to a state with a curated operation.</p></div><button type="button" onClick={() => setCreateSite(true)}>Create site</button></section><WeeklyMap stateCode={stateCode} mode="portfolio" onMode={() => undefined} sites={sites} selectedSite={mapSite} day={null} hour={hour} jobs={[]} crews={[]} onSelectSite={(siteId) => { if (session) void loadSite(session, siteId); }} onSelectJob={() => undefined} onSelectCrew={() => undefined} onSelectBuilding={() => undefined} onMoveJob={() => undefined} onAssignCrew={() => undefined} onMapPoint={(longitude, latitude) => { setMapPoint({ longitude, latitude }); setCreateSite(true); }} /></div>}
        {data && <div className="weekly-workspace"><header className="weekly-heading"><div><span className="eyebrow">Seven-day operation · {data.site.state_code} · {data.site.timezone}</span><h1>{data.site.name}</h1><p>{data.site.source_label}</p></div>{analysis && (() => { const recommendation = analysis.plan_metrics?.heatshift || analysis.metrics; return <div className="weekly-result-callout"><span>Recommended plan</span><strong>{recommendation.risk_reduction_percent.toFixed(1)}% lower</strong><small>score-50 exposure · {recommendation.residual_alerts} residual alert{recommendation.residual_alerts === 1 ? "" : "s"}</small></div>; })()}</header>
          {data.days.length > 0 && <div className="week-day-picker" role="tablist" aria-label="Week days">{data.days.map((day, index) => <button type="button" role="tab" aria-selected={index === dayIndex} onClick={() => setDayIndex(index)} key={day.date}><span>{dateLabel(day.date).split(",")[0]}</span><strong>{day.date.slice(8)}</strong><small>{Math.max(...day.conditions.map((item) => item.apparent_temperature_c)).toFixed(0)}° peak</small></button>)}</div>}
          <WeeklyMap stateCode={stateCode} mode={mapMode} onMode={setMapMode} sites={sites} selectedSite={data.site} day={currentDay || null} hour={hour} jobs={data.jobs.filter((job) => !currentDay || job.original_start.slice(0, 10) === currentDay.date || analysis?.working.some((entry) => entry.job_id === job.job_id && entry.start.slice(0, 10) === currentDay.date))} crews={data.crews} onSelectSite={(siteId) => { if (session) { setMapMode("site"); void loadSite(session, siteId); } }} onSelectJob={(id) => setDrawer({ type: "job", id })} onSelectCrew={(id) => setDrawer({ type: "crew", id })} onSelectBuilding={(value) => setDrawer({ type: "building", value })} onMoveJob={(jobId, longitude, latitude) => void moveJobLocation(jobId, longitude, latitude)} onAssignCrew={assignCrew} onMapPoint={(longitude, latitude) => { if (mapMode === "portfolio") { setMapPoint({ longitude, latitude }); setCreateSite(true); } else void addJobAtPoint(longitude, latitude); }} />
          {currentDay && <><div className="hour-control"><label htmlFor="hour-slider"><span>Simulated local hour</span><strong>{String(hour).padStart(2, "0")}:00</strong></label><input id="hour-slider" type="range" min="0" max="23" value={hour} onChange={(event) => setHour(Number(event.target.value))} /><div><span>00:00</span><span>No status changes happen automatically</span><span>23:00</span></div></div><JobStatusBoard data={data} analysis={analysis} day={currentDay.date} hour={hour} onJob={(id) => setDrawer({ type: "job", id })} /><ConditionsChart day={currentDay} hour={hour} /></>}
          {analysis && <><Metrics analysis={analysis} onMetric={(key) => setDrawer({ type: "metric", key })} />{currentDay && <DayTimeline data={data} analysis={analysis} day={currentDay.date} layer={layer} onLayer={setLayer} onMove={moveJob} onAssign={assignCrew} onApplyOne={applyOne} onUndo={undo} canUndo={history.length > 0} onReset={() => void applyWorking(analysis.heatshift.map((item) => ({ ...item, source: "working" })))} />}<div className="apply-plan-row"><div><strong>{analysis.metrics.constraint_valid ? "Constraint-valid proposal" : "Review violations"}</strong><span>{analysis.metrics.tasks_rescheduled} jobs moved · {analysis.metrics.fixed_tasks_preserved} fixed preserved · {analysis.metrics.productive_task_time_retained_percent}% work retained</span></div><button type="button" onClick={() => void applyWorking(analysis.heatshift.map((item) => ({ ...item, source: "working" })))}>Apply full HeatShift plan</button></div><Briefing analysis={analysis} onAsk={() => setDrawer({ type: "metric", key: "risk_reduction" })} /><section className="weekly-safety"><span>!</span><p><strong>Screening-level decision support.</strong> Verify conditions with on-site measurements and qualified safety judgment. HeatShift does not claim medical accuracy or injury prevention.</p></section></>}
          {!data.days.length && session && workspace && <ProvisioningPanel session={session} workspace={workspace} site={data.site} onReady={loadProvisionedSite} />}
        </div>}
      </main>
    </div>
    {data && analysis && session && <ContextDrawer context={drawer} data={data} analysis={analysis} session={session} onClose={() => setDrawer(null)} />}
    <Walkthrough open={walkthrough} onClose={() => void completeWalkthrough()} onComplete={() => void completeWalkthrough()} />
    <CreateSiteDialog open={createSite} stateCode={stateCode} point={mapPoint} onClose={() => { setCreateSite(false); setMapPoint(null); }} onCreate={createNewSite} />
  </>;
}
