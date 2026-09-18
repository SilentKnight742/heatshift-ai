"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DailyMap from "@/components/DailyMap";
import type { BuildingEstimate } from "@/components/WeeklyMap";
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
  type StateOption,
} from "@/lib/api";

type MapMode = "portfolio" | "site";
type PlanLayer = "original" | "heatshift";

const DEFAULT_SIMULATION = { seed: 42, crew_count: 8, jobs_per_crew: 5 };

function timeLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function workflowLabel(site: DailySite) {
  if (site.workflow_stage === "analyzed") return "Analysis ready";
  if (site.workflow_stage === "simulation_ready") return "Simulation ready";
  return "Site created";
}

function evidenceLabel(site: DailySite) {
  return site.evidence_kind === "fortyguard_cached" ? "Real cached FortyGuard day" : "Local simulated weather";
}

function ConditionsChart({ evidence, hour }: { evidence: DailyEvidence; hour: number }) {
  const apparent = evidence.conditions.map((item) => item.apparent_temperature_c);
  const min = Math.min(...apparent) - 1;
  const max = Math.max(...apparent) + 1;
  const y = (value: number) => 120 - (value - min) / Math.max(max - min, 1) * 96;
  const points = apparent.map((value, index) => `${index / 23 * 760},${y(value)}`).join(" ");
  const selected = evidence.conditions[hour] || evidence.conditions[0];
  return <section className="daily-conditions-card">
    <div className="daily-section-head"><div><span className="eyebrow">Hourly environment</span><h2>Conditions through the day</h2></div><div className="daily-condition-now"><strong>{selected.apparent_temperature_c.toFixed(1)}°C</strong><span>apparent · {String(hour).padStart(2, "0")}:00</span></div></div>
    <svg viewBox="0 0 760 145" role="img" aria-label="Hourly apparent temperature chart">
      <line x1="0" y1={y(35)} x2="760" y2={y(35)} className="daily-threshold-line" />
      <polyline points={points} className="daily-temperature-line" />
      <circle cx={hour / 23 * 760} cy={y(selected.apparent_temperature_c)} r="6" className="daily-temperature-point" />
      <text x="6" y={Math.max(12, y(35) - 6)}>35°C burden baseline</text>
    </svg>
    <div className="daily-chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
    <div className="daily-condition-grid"><span><small>Temperature</small><strong>{selected.temperature_c.toFixed(1)}°C</strong></span><span><small>Wet bulb</small><strong>{selected.wet_bulb_temperature_c.toFixed(1)}°C</strong></span><span><small>Humidity</small><strong>{selected.relative_humidity_percent.toFixed(0)}%</strong></span><span><small>Solar GHI</small><strong>{selected.solar_irradiance_ghi_wm2.toFixed(0)} W/m²</strong></span></div>
  </section>;
}

function DailyTimeline({ data, analysis }: { data: DailyWorkspace; analysis: DailyAnalysis }) {
  const [layer, setLayer] = useState<PlanLayer>("heatshift");
  const entries = analysis[layer];
  const entriesByCrew = useMemo(() => {
    const grouped = new Map<string, DailyScheduleEntry[]>();
    data.crews.forEach((crew) => grouped.set(crew.crew_id, []));
    entries.forEach((entry) => grouped.get(entry.crew_id)?.push(entry));
    return grouped;
  }, [data.crews, entries]);
  const jobs = new Map(data.jobs.map((job) => [job.job_id, job]));
  const startHour = 6;
  const spanHours = 14;
  return <section className="daily-timeline-card">
    <div className="daily-section-head"><div><span className="eyebrow">Constraint-valid schedule</span><h2>One day, before and after</h2></div><div className="plan-switcher" role="tablist"><button type="button" role="tab" aria-selected={layer === "original"} onClick={() => setLayer("original")}>Original</button><button type="button" role="tab" aria-selected={layer === "heatshift"} onClick={() => setLayer("heatshift")}>HeatShift</button></div></div>
    <div className="daily-timeline-scroll"><div className="daily-time-ruler"><span /><div>{Array.from({ length: 8 }, (_, index) => <span key={index}>{String(startHour + index * 2).padStart(2, "0")}:00</span>)}</div></div>
      {data.crews.map((crew) => <div className="daily-crew-row" key={crew.crew_id}><div><strong>{crew.name}</strong><small>{crew.worker_count} workers</small></div><div className="daily-crew-track">{(entriesByCrew.get(crew.crew_id) || []).map((entry) => {
        const job = jobs.get(entry.job_id); if (!job) return null;
        const start = new Date(entry.start); const localParts = new Intl.DateTimeFormat("en-US", { timeZone: data.site.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(start); const values = Object.fromEntries(localParts.map((item) => [item.type, item.value])); const decimal = Number(values.hour) + Number(values.minute) / 60;
        const width = Math.max(4, (job.duration_minutes / 60) / spanHours * 100); const left = Math.max(0, (decimal - startHour) / spanHours * 100);
        return <button type="button" title={`${job.name} · ${timeLabel(entry.start, data.site.timezone)} · score ${entry.screening_score}`} className={entry.screening_score >= 75 ? "critical" : entry.screening_score >= 50 ? "high" : "lower"} style={{ left: `${left}%`, width: `${width}%` }} key={entry.job_id}><span>{job.name.split(" · ")[0]}</span><b>{entry.screening_score}</b></button>;
      })}</div></div>)}
    </div>
    <div className="daily-timeline-legend"><span><i className="lower" />Below 50</span><span><i className="high" />50–74</span><span><i className="critical" />75+</span><span>Scores are screening values, not medical limits.</span></div>
  </section>;
}

function Metrics({ analysis }: { analysis: DailyAnalysis }) {
  const metrics = analysis.metrics;
  const cards = [
    ["Exposure reduction", `${metrics.risk_reduction_percent.toFixed(1)}%`, `${metrics.original_exposure_worker_minutes.toLocaleString()} → ${metrics.proposed_exposure_worker_minutes.toLocaleString()} worker-min`],
    ["High-risk time avoided", `${metrics.high_risk_hours_avoided.toFixed(1)} h`, "risk-weighted worker time"],
    ["Crew Exposure Load", metrics.proposed_crew_exposure_load.toFixed(1), `${metrics.original_crew_exposure_load.toFixed(1)} before`],
    ["Schedule changes", String(metrics.tasks_rescheduled), `${metrics.disruption.total_minutes_shifted.toLocaleString()} total shifted min`],
  ];
  return <><section className="daily-metrics" aria-label="Analysis result metrics">{cards.map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</section>
    <section className="daily-result-strip"><div><span>Fixed jobs preserved</span><strong>{metrics.fixed_tasks_preserved}</strong></div><div><span>Work retained</span><strong>{metrics.productive_task_time_retained_percent.toFixed(0)}%</strong></div><div><span>Residual alerts</span><strong>{metrics.residual_alerts}</strong></div><div><span>Hard violations</span><strong>{metrics.disruption.hard_constraint_violations}</strong></div></section>
    <section className="daily-explanations"><span className="eyebrow">Open calculations</span><h2>What these numbers mean</h2>{Object.values(analysis.explanations).map((item) => <details key={item.metric}><summary><strong>{item.metric}</strong><span>{item.comparison}</span></summary><div><p>{item.definition}</p><code>{item.formula}</code><p><b>Source:</b> {item.source}</p><p>{item.limitations.join(" ")}</p></div></details>)}</section>
  </>;
}

function CreateSiteDialog({ open, state, point, onClose, onCreate }: { open: boolean; state: StateOption | undefined; point: { longitude: number; latitude: number } | null; onClose: () => void; onCreate: (payload: Record<string, unknown>) => Promise<void> }) {
  const centre = state ? stateCentre(state.code) : { longitude: -112.0675, latitude: 33.4515 };
  const [name, setName] = useState("New operation site"); const [siteType, setSiteType] = useState("outdoor operations site"); const [longitude, setLongitude] = useState(String(point?.longitude ?? centre.longitude)); const [latitude, setLatitude] = useState(String(point?.latitude ?? centre.latitude)); const [radius, setRadius] = useState("600"); const [operationDate, setOperationDate] = useState(new Date().toISOString().slice(0, 10)); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setLongitude(String(point?.longitude ?? centre.longitude)); setLatitude(String(point?.latitude ?? centre.latitude)); } }, [open, point, centre.longitude, centre.latitude]);
  if (!open || !state) return null;
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { await onCreate({ name, state_code: state.code, site_type: siteType, operation_date: operationDate, geometry: { type: "coordinates", longitude: Number(longitude), latitude: Number(latitude), radius_m: Number(radius) } }); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Site could not be created."); } finally { setBusy(false); } };
  return <div className="walkthrough-backdrop" role="dialog" aria-modal="true" aria-label="Create daily operation site"><form className="create-site-card daily-create-card" onSubmit={submit}><button type="button" className="walkthrough-close" onClick={onClose} aria-label="Close">×</button><span className="eyebrow">New site · {state.name}</span><h2>Choose the operation location</h2><p>This local milestone generates a clearly labeled weather profile for new sites. The three built-in sites use cached FortyGuard evidence.</p><label><span>Site name</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label><label><span>Operation type</span><input value={siteType} onChange={(event) => setSiteType(event.target.value)} required /></label><div className="field-pair"><label><span>Longitude</span><input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} required /></label><label><span>Latitude</span><input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} required /></label></div><div className="field-pair"><label><span>Site radius · metres</span><input type="number" min="100" max="5000" value={radius} onChange={(event) => setRadius(event.target.value)} required /></label><label><span>Simulation date</span><input type="date" min="2019-01-01" max={new Date().toISOString().slice(0, 10)} value={operationDate} onChange={(event) => setOperationDate(event.target.value)} required /></label></div>{error && <p className="dialog-error" role="alert">{error}</p>}<button className="create-site-submit" type="submit" disabled={busy}>{busy ? "Creating…" : "Create site"}</button></form></div>;
}

export default function DailyConsole() {
  const [session, setSession] = useState<AuthSession | null>(null); const [states, setStates] = useState<StateOption[]>([]); const [allSites, setAllSites] = useState<DailySite[]>([]); const [stateCode, setStateCode] = useState("AZ"); const [data, setData] = useState<DailyWorkspace | null>(null); const [mapMode, setMapMode] = useState<MapMode>("site"); const [hour, setHour] = useState(15); const [simulation, setSimulation] = useState(DEFAULT_SIMULATION); const [busy, setBusy] = useState<"loading" | "generating" | "analyzing" | null>("loading"); const [error, setError] = useState<string | null>(null); const [createOpen, setCreateOpen] = useState(false); const [mapPoint, setMapPoint] = useState<{ longitude: number; latitude: number } | null>(null); const [selectedJob, setSelectedJob] = useState<DailyJob | null>(null); const [selectedCell, setSelectedCell] = useState<BuildingEstimate | null>(null);
  const stateSites = useMemo(() => allSites.filter((site) => site.state_code === stateCode), [allSites, stateCode]);
  const currentState = states.find((state) => state.code === stateCode);

  const loadSite = async (activeSession: AuthSession, siteId: string) => {
    const workspace = await dailyApi.site(activeSession, siteId); setData(workspace); setStateCode(workspace.site.state_code); setMapMode("site"); setSelectedJob(null); setSelectedCell(null); setAllSites((items) => items.map((site) => site.site_id === workspace.site.site_id ? workspace.site : site));
  };
  useEffect(() => { let cancelled = false; void (async () => { try { const active = await getAnonymousSession(); const [stateList, sites] = await Promise.all([dailyApi.states(active), dailyApi.sites(active)]); if (cancelled) return; setSession(active); setStates(stateList); setAllSites(sites); const first = sites.find((site) => site.site_id === "desertline-phoenix") || sites[0]; if (first) await loadSite(active, first.site_id); } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : "The daily console could not be loaded."); } finally { if (!cancelled) setBusy(null); } })(); return () => { cancelled = true; }; }, []);
  const chooseState = (code: string) => { setStateCode(code); setData(null); setMapMode("portfolio"); setSelectedJob(null); setSelectedCell(null); };
  const chooseSite = async (siteId: string) => { if (!session) return; setBusy("loading"); setError(null); try { await loadSite(session, siteId); } catch (caught) { setError(caught instanceof Error ? caught.message : "Site could not be loaded."); } finally { setBusy(null); } };
  const generate = async () => { if (!session || !data) return; setBusy("generating"); setError(null); try { const workspace = await dailyApi.generate(session, data.site.site_id, simulation); setData(workspace); setAllSites((items) => items.map((site) => site.site_id === workspace.site.site_id ? workspace.site : site)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Simulation could not be generated."); } finally { setBusy(null); } };
  const analyze = async () => { if (!session || !data) return; setBusy("analyzing"); setError(null); try { const analysis = await dailyApi.analyze(session, data.site.site_id); const workspace = { ...data, analysis, site: { ...data.site, workflow_stage: "analyzed" as const } }; setData(workspace); setAllSites((items) => items.map((site) => site.site_id === workspace.site.site_id ? workspace.site : site)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Analysis could not be completed."); } finally { setBusy(null); } };
  const createSite = async (payload: Record<string, unknown>) => { if (!session) return; const site = await dailyApi.createSite(session, payload); const sites = await dailyApi.sites(session); setAllSites(sites); await loadSite(session, site.site_id); };
  const removeSite = async () => { if (!session || !data || data.site.curated || !window.confirm(`Delete ${data.site.name}?`)) return; await dailyApi.deleteSite(session, data.site.site_id); const sites = await dailyApi.sites(session); setAllSites(sites); setData(null); setMapMode("portfolio"); };

  if (busy === "loading" && !data) return <div className="weekly-initializing"><div className="loading-orbit"><i /><i /><i /></div><h1>Preparing daily operations</h1><p>Loading three analyzed examples and the local workspace.</p></div>;
  const activeJobs = data?.analysis ? data.analysis.heatshift.filter((entry) => { const selected = new Date(entry.start); const parts = new Intl.DateTimeFormat("en-US", { timeZone: data.site.timezone, hour: "2-digit", hourCycle: "h23" }).formatToParts(selected); return Number(parts.find((part) => part.type === "hour")?.value) === hour; }).map((entry) => entry.job_id) : [];
  return <>
    <div className="weekly-toolbar daily-toolbar"><label><span>State</span><select value={stateCode} onChange={(event) => chooseState(event.target.value)}>{states.map((state) => <option value={state.code} key={state.code}>{state.name}</option>)}</select></label><div className="daily-example-links"><span>Analyzed examples</span>{allSites.filter((site) => site.curated).map((site) => <button type="button" key={site.site_id} onClick={() => void chooseSite(site.site_id)}>{site.state_code}</button>)}</div><div className="toolbar-source"><span className={`daily-workflow-pill stage-${data?.site.workflow_stage || "empty"}`}><i />{data ? workflowLabel(data.site) : "No site selected"}</span><small>{data ? evidenceLabel(data.site) : `${stateSites.length} sites in ${stateCode}`}</small></div><div className="toolbar-actions"><button type="button" onClick={() => { setMapPoint(null); setCreateOpen(true); }}>+ Create site</button></div></div>
    <div className="weekly-shell daily-shell"><aside className="weekly-sidebar daily-sidebar"><div className="weekly-sidebar-title"><div><span className="eyebrow">Daily operation</span><h2>Build and analyze</h2></div></div><div className="daily-side-scroll"><section><span className="daily-side-label">Sites in {stateCode}</span><div className="weekly-list">{stateSites.length ? stateSites.map((site) => <button className={`site-list-card${data?.site.site_id === site.site_id ? " active" : ""}`} type="button" key={site.site_id} onClick={() => void chooseSite(site.site_id)}><span className="site-list-icon">⌖</span><span><strong>{site.name}</strong><small>{site.site_type}</small><em className="daily-card-status">{workflowLabel(site)}</em></span></button>) : <div className="weekly-empty"><strong>No sites yet</strong><p>Double-click the state map or create one by coordinates.</p></div>}</div></section>
      {data && <><section className="daily-flow"><span className="daily-side-label">Product flow</span><ol><li className="complete"><b>1</b><span><strong>Site selected</strong><small>{data.site.name}</small></span></li><li className={data.simulation ? "complete" : ""}><b>2</b><span><strong>Generate simulation</strong><small>Crews, jobs, constraints and a baseline day</small></span></li><li className={data.analysis ? "complete" : ""}><b>3</b><span><strong>Run analysis</strong><small>Weather + metrics + schedule optimization</small></span></li></ol></section><section className="daily-simulation-controls"><span className="daily-side-label">Simulation scale</span><label>Random seed<input type="number" min="0" value={simulation.seed} onChange={(event) => setSimulation({ ...simulation, seed: Number(event.target.value) })} /></label><label>Crews<select value={simulation.crew_count} onChange={(event) => setSimulation({ ...simulation, crew_count: Number(event.target.value) })}>{[6, 8, 10, 12].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label>Jobs per crew<select value={simulation.jobs_per_crew} onChange={(event) => setSimulation({ ...simulation, jobs_per_crew: Number(event.target.value) })}>{[3, 4, 5, 6].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><button className="daily-primary-action" type="button" onClick={() => void generate()} disabled={Boolean(busy)}>{busy === "generating" ? "Generating operation…" : data.simulation ? "Generate a new simulation" : "Generate simulation"}</button><button className="daily-analysis-action" type="button" onClick={() => void analyze()} disabled={Boolean(busy) || !data.simulation}>{busy === "analyzing" ? "Running analysis…" : "Run HeatShift analysis"}</button>{data.simulation && <p>{data.simulation.worker_count} workers · {data.simulation.job_count} jobs · seed {data.simulation.seed}<br />{data.simulation.generation_mode === "ai_enriched_stochastic" ? "AI-enriched names + seeded operations" : "Seeded stochastic operations · AI fallback"}</p>}</section>{!data.site.curated && <button className="daily-delete" type="button" onClick={() => void removeSite()}>Delete this local site</button>}</>}
      </div><div className="weekly-sidebar-note"><strong>Weather and operations stay distinct.</strong><p>Built-in weather is cached provider evidence. New-site weather and every crew/job are explicitly simulated.</p></div></aside>
      <main className="weekly-main">{busy && <div className="weekly-progress"><i />{busy === "generating" ? "Generating a large daily operation…" : busy === "analyzing" ? "Scoring every task-hour and optimizing the schedule…" : "Loading site…"}</div>}{error && <div className="weekly-error" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
        <div className="weekly-workspace">{!data ? <><section className="weekly-no-site compact"><span>⌖</span><div><h1>{currentState?.name || stateCode} operations</h1><p>Select a site, or double-click the map to place a new daily operation.</p></div><button type="button" onClick={() => setCreateOpen(true)}>Create site</button></section><DailyMap stateCode={stateCode} mode="portfolio" onMode={setMapMode} sites={stateSites} selectedSite={null} evidence={null} hour={hour} jobs={[]} crews={[]} onSelectSite={(id) => void chooseSite(id)} onSelectJob={() => undefined} onSelectCell={() => undefined} onMapPoint={(longitude, latitude) => { setMapPoint({ longitude, latitude }); setCreateOpen(true); }} /></> : <><header className="weekly-heading daily-heading"><div><span className="eyebrow">One-day operation · {data.site.state_code} · {dateLabel(data.site.operation_date)}</span><h1>{data.site.name}</h1><p>{data.site.source_label}</p></div>{data.analysis && <div className="weekly-result-callout"><span>HeatShift proposal</span><strong>{data.analysis.metrics.risk_reduction_percent.toFixed(1)}% lower</strong><small>score-50 exposure · {data.analysis.metrics.residual_alerts} residual alerts</small></div>}</header><DailyMap stateCode={stateCode} mode={mapMode} onMode={setMapMode} sites={stateSites} selectedSite={data.site} evidence={data.evidence} hour={hour} jobs={data.jobs} crews={data.crews} onSelectSite={(id) => void chooseSite(id)} onSelectJob={(id) => setSelectedJob(data.jobs.find((job) => job.job_id === id) || null)} onSelectCell={setSelectedCell} onMapPoint={() => undefined} />
          {(selectedJob || selectedCell) && <section className="daily-inspector"><button type="button" onClick={() => { setSelectedJob(null); setSelectedCell(null); }}>×</button>{selectedJob ? <><span className="eyebrow">Selected job</span><h3>{selectedJob.name}</h3><p>{selectedJob.duration_minutes} minutes · {selectedJob.workload.replace("_", " ")} workload · {selectedJob.movable ? "movable" : "fixed"} · {selectedJob.shaded ? "shade available" : "unshaded"}</p></> : selectedCell && <><span className="eyebrow">Selected thermal cell</span><h3>{selectedCell.apparentTemperatureC?.toFixed(1)}°C apparent</h3><p>Hourly site estimate at this location. It is not a building or worker sensor reading.</p></>}</section>}
          {data.evidence && <><div className="hour-control"><label htmlFor="daily-hour"><span>Simulated local hour</span><strong>{String(hour).padStart(2, "0")}:00</strong></label><input id="daily-hour" type="range" min="0" max="23" value={hour} onChange={(event) => setHour(Number(event.target.value))} /><div><span>00:00</span><span>{activeJobs.length} proposed jobs begin this hour</span><span>23:00</span></div></div><ConditionsChart evidence={data.evidence} hour={hour} /></>}
          {!data.simulation && <section className="daily-empty-stage"><span>2</span><div><h2>Generate the operation</h2><p>The site exists. Use the left panel to generate crews, jobs, constraints and the submitted daily schedule.</p></div></section>}
          {data.simulation && <section className="daily-operation-summary"><div><span>Workers</span><strong>{data.simulation.worker_count}</strong></div><div><span>Crews</span><strong>{data.simulation.crew_count}</strong></div><div><span>Total jobs</span><strong>{data.simulation.job_count}</strong></div><div><span>Movable / fixed</span><strong>{data.simulation.movable_job_count} / {data.simulation.fixed_job_count}</strong></div></section>}
          {data.simulation && !data.analysis && <section className="daily-empty-stage"><span>3</span><div><h2>Baseline generated. Run the analysis.</h2><p>HeatShift will combine the hourly weather field, task and crew risk factors, and hard scheduling constraints to propose a lower-exposure plan.</p></div><button type="button" onClick={() => void analyze()}>Run HeatShift analysis</button></section>}
          {data.analysis && <><Metrics analysis={data.analysis} /><DailyTimeline data={data} analysis={data.analysis} /><section className="weekly-briefing daily-briefing"><div className="briefing-side"><span>HS</span><strong>Operational briefing</strong><small>Derived from the completed deterministic analysis</small></div><div className="briefing-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{data.analysis.briefing_markdown}</ReactMarkdown></div></section><section className="weekly-safety"><span>!</span><p><strong>Screening-level planning support.</strong> HeatShift does not replace on-site measurements, medical guidance or a qualified safety professional. It never claims that schedule changes eliminate heat risk.</p></section></>}
        </>}</div>
      </main>
    </div>
    <CreateSiteDialog open={createOpen} state={currentState} point={mapPoint} onClose={() => { setCreateOpen(false); setMapPoint(null); }} onCreate={createSite} />
  </>;
}

