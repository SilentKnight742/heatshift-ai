"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DailyCrew, DailyJob, DailyScheduleEntry, DailyWorkspace } from "@/lib/api";

type SimulationControls = { seed: number; crew_count: number; jobs_per_crew: number };
type Props = {
  open: boolean;
  workspace: DailyWorkspace | null;
  busy: "loading" | "generating" | "analyzing" | null;
  simulation: SimulationControls;
  onSimulation: (value: SimulationControls) => void;
  onGenerate: () => void;
  onAnalyze: () => void;
  onClose: () => void;
};

const formatTime = (value: string) => value.slice(11, 16);
const minute = (value: string) => Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const movedMinutes = (before: DailyScheduleEntry, after: DailyScheduleEntry) => Math.round((new Date(after.start).getTime() - new Date(before.start).getTime()) / 60_000);
const riskTone = (score: number) => score >= 75 ? "critical" : score >= 50 ? "high" : score >= 30 ? "moderate" : "low";

function WeatherChart({ workspace }: { workspace: DailyWorkspace }) {
  const values = workspace.evidence?.conditions || [];
  if (!values.length) return <div className="method-empty-chart">Generate the operation to create its hourly condition profile.</div>;
  const series = values.flatMap((item) => [item.temperature_c, item.apparent_temperature_c]);
  const minimum = Math.floor(Math.min(...series) - 2);
  const maximum = Math.ceil(Math.max(...series) + 2);
  const x = (index: number) => 36 + index / Math.max(values.length - 1, 1) * 824;
  const y = (value: number) => 210 - (value - minimum) / Math.max(maximum - minimum, 1) * 170;
  const apparent = values.map((item, index) => `${x(index)},${y(item.apparent_temperature_c)}`).join(" ");
  const air = values.map((item, index) => `${x(index)},${y(item.temperature_c)}`).join(" ");
  const area = `${x(0)},210 ${apparent} ${x(values.length - 1)},210`;
  const tickHours = [0, 3, 6, 9, 12, 15, 18, 21, 23];
  return <div className="method-weather-chart">
    <svg viewBox="0 0 900 250" role="img" aria-label="Hourly air and apparent temperature across the operation day">
      {[0, .25, .5, .75, 1].map((position) => { const value = minimum + (maximum - minimum) * position; return <g key={position}><line x1="36" x2="860" y1={y(value)} y2={y(value)} /><text x="3" y={y(value) + 4}>{Math.round(value)}°</text></g>; })}
      <polygon points={area} />
      <polyline className="weather-air-line" points={air} />
      <polyline className="weather-apparent-line" points={apparent} />
      {tickHours.map((hour) => <text className="weather-hour" x={x(hour)} y="237" textAnchor="middle" key={hour}>{String(hour).padStart(2, "0")}</text>)}
    </svg>
    <div className="method-chart-legend"><span><i className="apparent" />Apparent temperature</span><span><i className="air" />Air temperature</span><small>Local hour</small></div>
  </div>;
}

function ScheduleBoard({ workspace }: { workspace: DailyWorkspace }) {
  const analysis = workspace.analysis;
  const original = analysis?.original || workspace.jobs.map((job) => ({ job_id: job.job_id, crew_id: job.assigned_crew_id, start: job.original_start, end: new Date(new Date(job.original_start).getTime() + job.duration_minutes * 60_000).toISOString(), source: "original" as const, screening_score: 0 }));
  const layers = analysis ? [{ label: "Submitted", entries: original }, { label: "HeatShift", entries: analysis.heatshift }] : [{ label: "Submitted", entries: original }];
  const jobs = new Map(workspace.jobs.map((job) => [job.job_id, job]));
  const rangeStart = 360;
  const rangeEnd = 1200;
  return <div className="schedule-board">
    <div className="schedule-axis"><span /><span>06</span><span>09</span><span>12</span><span>15</span><span>18</span><span>20</span></div>
    {workspace.crews.map((crew) => <div className="schedule-crew-group" key={crew.crew_id}>
      <strong>{crew.name}</strong>
      {layers.map((layer) => <div className="schedule-layer" key={layer.label}><small>{layer.label}</small><div>{layer.entries.filter((entry) => entry.crew_id === crew.crew_id).map((entry) => { const job = jobs.get(entry.job_id); const left = Math.max(0, Math.min(100, (minute(entry.start) - rangeStart) / (rangeEnd - rangeStart) * 100)); const width = Math.max(1.8, (minute(entry.end) - minute(entry.start)) / (rangeEnd - rangeStart) * 100); return <i className={riskTone(entry.screening_score)} style={{ left: `${left}%`, width: `${width}%` }} title={`${job?.name || entry.job_id}: ${formatTime(entry.start)}–${formatTime(entry.end)} · score ${entry.screening_score}`} key={entry.job_id} />; })}</div></div>)}
    </div>)}
  </div>;
}

function CrewGrid({ crews, jobs }: { crews: DailyCrew[]; jobs: DailyJob[] }) {
  return <div className="method-crew-grid">{crews.map((crew) => { const crewJobs = jobs.filter((job) => job.assigned_crew_id === crew.crew_id); return <article key={crew.crew_id}>
    <header><span>{crew.name.slice(0, 2).toUpperCase()}</span><div><strong>{crew.name}</strong><small>{crew.worker_count} workers · {crewJobs.length} jobs</small></div></header>
    <dl><div><dt>Acclimatization</dt><dd>{titleCase(crew.acclimatization_status)}</dd></div><div><dt>PPE burden</dt><dd>{titleCase(crew.ppe_level)}</dd></div><div><dt>Default work</dt><dd>{titleCase(crew.default_workload)}</dd></div></dl>
  </article>; })}</div>;
}

function JobTable({ workspace }: { workspace: DailyWorkspace }) {
  const [changesOnly, setChangesOnly] = useState(false);
  const crewNames = new Map(workspace.crews.map((crew) => [crew.crew_id, crew.name]));
  const before = new Map(workspace.analysis?.original.map((entry) => [entry.job_id, entry]) || []);
  const after = new Map(workspace.analysis?.heatshift.map((entry) => [entry.job_id, entry]) || []);
  const rows = workspace.jobs.filter((job) => {
    if (!changesOnly || !workspace.analysis) return true;
    return before.get(job.job_id)?.start !== after.get(job.job_id)?.start || before.get(job.job_id)?.crew_id !== after.get(job.job_id)?.crew_id;
  });
  return <div className="method-job-table-wrap">
    <div className="method-table-toolbar"><div><strong>Job-level comparison</strong><span>{rows.length} of {workspace.jobs.length} jobs shown</span></div>{workspace.analysis && <label><input type="checkbox" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} /> Changes only</label>}</div>
    <div className="method-job-table-scroll"><table><thead><tr><th>Operation</th><th>Crew</th><th>Constraints</th><th>Submitted</th><th>HeatShift</th><th>Score</th></tr></thead><tbody>{rows.map((job) => { const original = before.get(job.job_id); const proposed = after.get(job.job_id); const delta = original && proposed ? movedMinutes(original, proposed) : 0; return <tr className={delta || original?.crew_id !== proposed?.crew_id ? "changed" : ""} key={job.job_id}>
      <td><strong>{job.name}</strong><small>{titleCase(job.workload)} · {job.duration_minutes} min</small></td>
      <td>{crewNames.get(proposed?.crew_id || job.assigned_crew_id)}{original && proposed && original.crew_id !== proposed.crew_id && <small>from {crewNames.get(original.crew_id)}</small>}</td>
      <td><span className={job.movable ? "job-pill movable" : "job-pill fixed"}>{job.movable ? "Movable" : "Fixed"}</span><small>{job.shaded ? "Shade" : "Sun"} · {job.eligible_crew_ids.length} eligible</small></td>
      <td>{formatTime(original?.start || job.original_start)}{original && <small className={`risk-${riskTone(original.screening_score)}`}>score {original.screening_score}</small>}</td>
      <td>{proposed ? formatTime(proposed.start) : "—"}{proposed && <small>{delta === 0 ? "unchanged" : `${delta > 0 ? "+" : ""}${delta} min`}</small>}</td>
      <td>{proposed ? <span className={`score-comparison ${riskTone(proposed.screening_score)}`}><b>{original?.screening_score}</b><i>→</i><strong>{proposed.screening_score}</strong></span> : "Pending"}</td>
    </tr>; })}</tbody></table></div>
  </div>;
}

function MetricsStory({ workspace }: { workspace: DailyWorkspace }) {
  const metrics = workspace.analysis?.metrics;
  if (!metrics) return <div className="method-awaiting"><i>03</i><div><strong>Analysis has not run yet.</strong><p>Generate the operation first, then run HeatShift to populate before/after metrics and a validated proposal.</p></div></div>;
  const exposureMax = Math.max(metrics.original_exposure_worker_minutes, metrics.proposed_exposure_worker_minutes, 1);
  const loadMax = Math.max(metrics.original_crew_exposure_load, metrics.proposed_crew_exposure_load, 1);
  return <>
    <div className="method-comparison-grid">
      <article><span>Threshold exposure</span><strong>{metrics.risk_reduction_percent.toFixed(1)}% lower</strong><div className="comparison-bar before" style={{ "--bar": `${metrics.original_exposure_worker_minutes / exposureMax * 100}%` } as React.CSSProperties}><i /><small>{metrics.original_exposure_worker_minutes.toLocaleString()} worker-min before</small></div><div className="comparison-bar after" style={{ "--bar": `${metrics.proposed_exposure_worker_minutes / exposureMax * 100}%` } as React.CSSProperties}><i /><small>{metrics.proposed_exposure_worker_minutes.toLocaleString()} after</small></div></article>
      <article><span>Crew Exposure Load</span><strong>{metrics.original_crew_exposure_load.toFixed(1)} → {metrics.proposed_crew_exposure_load.toFixed(1)}</strong><div className="comparison-bar before" style={{ "--bar": `${metrics.original_crew_exposure_load / loadMax * 100}%` } as React.CSSProperties}><i /><small>risk-weighted worker-hours before</small></div><div className="comparison-bar after" style={{ "--bar": `${metrics.proposed_crew_exposure_load / loadMax * 100}%` } as React.CSSProperties}><i /><small>after</small></div></article>
      <article className="thermal"><span>Site Thermal Burden</span><strong>{metrics.site_thermal_burden_degree_hours.toFixed(1)}°h</strong><p>Heat intensity above the disclosed 35°C apparent-temperature baseline, accumulated over the day.</p></article>
    </div>
    <div className="method-outcomes"><article><strong>{metrics.high_risk_hours_avoided.toFixed(1)} h</strong><span>high-risk worker-time avoided</span></article><article><strong>{metrics.tasks_rescheduled}</strong><span>jobs moved</span></article><article><strong>{metrics.disruption.total_minutes_shifted}</strong><span>total shifted minutes</span></article><article><strong>{metrics.fixed_tasks_preserved}</strong><span>fixed jobs preserved</span></article><article><strong>{metrics.residual_alerts}</strong><span>jobs still exposed</span></article><article><strong>{metrics.disruption.hard_constraint_violations}</strong><span>hard violations</span></article></div>
  </>;
}

export default function OperationsMethodology({ open, workspace, busy, simulation, onSimulation, onGenerate, onAnalyze, onClose }: Props) {
  const [section, setSection] = useState("overview");
  useEffect(() => {
    if (!open) return;
    setSection("overview");
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, workspace?.site.site_id, onClose]);
  const jobStats = useMemo(() => {
    if (!workspace) return { fixed: 0, movable: 0, shaded: 0 };
    return { fixed: workspace.jobs.filter((job) => !job.movable).length, movable: workspace.jobs.filter((job) => job.movable).length, shaded: workspace.jobs.filter((job) => job.shaded).length };
  }, [workspace]);
  if (!open || !workspace) return null;
  const evidence = workspace.evidence;
  const apparent = evidence?.conditions.map((item) => item.apparent_temperature_c) || [];
  const cellTemperatures = evidence?.heat_cells.map((item) => item.apparent_temperature_c) || [];
  const peak = apparent.length ? Math.max(...apparent) : null;
  const cellMin = cellTemperatures.length ? Math.min(...cellTemperatures) : null;
  const cellMax = cellTemperatures.length ? Math.max(...cellTemperatures) : null;
  return <div className="operations-method-overlay" role="dialog" aria-modal="true" aria-label={`${workspace.site.name} operation and methodology`}>
    <header className="operations-method-header">
      <div className="operations-method-brand"><button type="button" onClick={onClose} aria-label="Close operation and methodology">←</button><div><span className="eyebrow">Operation & method</span><h1>{workspace.site.name}</h1></div></div>
      <div className="operations-method-meta"><span>{workspace.site.state_code}</span><span>{workspace.site.operation_date}</span><span className={workspace.site.curated ? "real" : "simulated"}>{workspace.site.curated ? "Cached provider evidence" : "Simulated local weather"}</span></div>
      <button className="operations-method-close" type="button" onClick={onClose}>Back to map <span>×</span></button>
    </header>
    <nav className="operations-method-nav" aria-label="Operation detail sections">{[["overview", "At a glance"], ["operations", "Crews & jobs"], ["weather", "Heat evidence"], ["metrics", "Metrics"], ["optimizer", "Scheduler"], ["briefing", "Briefing"]].map(([key, label]) => <button type="button" aria-selected={section === key} onClick={() => { setSection(key); document.getElementById(`method-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} key={key}>{label}</button>)}</nav>
    <main className="operations-method-scroll" onScroll={(event) => { const sections = ["overview", "operations", "weather", "metrics", "optimizer", "briefing"]; const top = event.currentTarget.getBoundingClientRect().top + 150; const current = [...sections].reverse().find((key) => (document.getElementById(`method-${key}`)?.getBoundingClientRect().top || Infinity) <= top); if (current && current !== section) setSection(current); }}>
      <section className="method-overview" id="method-overview">
        <div className="method-overview-copy"><span className="eyebrow">One operation day · one inspectable chain</span><h2>See the operation HeatShift received, what changed, and why.</h2><p>The map is the operating surface. This view opens the machinery underneath it: evidence, fictional operations, task-hour scores, scheduling choices and validated outcomes.</p></div>
        <div className="method-stage-card"><span>{workspace.site.workflow_stage === "analyzed" ? "Analysis ready" : workspace.simulation ? "Operation generated" : "Site ready"}</span><strong>{workspace.simulation ? `${workspace.simulation.worker_count} workers across ${workspace.simulation.crew_count} crews` : "Generate the fictional operation"}</strong><p>{workspace.simulation ? `${workspace.simulation.job_count} jobs · ${jobStats.fixed} fixed · ${jobStats.movable} movable` : "Choose the simulation scale, then build a reproducible day."}</p>
          {!workspace.simulation ? <div className="method-generation-controls"><label>Seed<input aria-label="Method random seed" type="number" min="0" value={simulation.seed} onChange={(event) => onSimulation({ ...simulation, seed: Number(event.target.value) })} /></label><label>Crews<select aria-label="Method crews" value={simulation.crew_count} onChange={(event) => onSimulation({ ...simulation, crew_count: Number(event.target.value) })}>{[6, 8, 10, 12].map((value) => <option key={value}>{value}</option>)}</select></label><label>Jobs / crew<select aria-label="Method jobs per crew" value={simulation.jobs_per_crew} onChange={(event) => onSimulation({ ...simulation, jobs_per_crew: Number(event.target.value) })}>{[3, 4, 5, 6].map((value) => <option key={value}>{value}</option>)}</select></label></div> : null}
          {!workspace.simulation ? <button type="button" onClick={onGenerate} disabled={Boolean(busy)}>{busy === "generating" ? "Generating operation…" : "Generate operation"}<span>→</span></button> : !workspace.analysis ? <button type="button" onClick={onAnalyze} disabled={Boolean(busy)}>{busy === "analyzing" ? "Running HeatShift…" : "Run HeatShift analysis"}<span>→</span></button> : <button type="button" onClick={() => { setSection("operations"); document.getElementById("method-operations")?.scrollIntoView({ behavior: "smooth" }); }}>Inspect the change <span>↓</span></button>}
        </div>
        <div className="method-pipeline" aria-label="HeatShift analysis pipeline"><article><i>01</i><span>Hourly + spatial heat</span></article><b>→</b><article><i>02</i><span>Jobs, crews and constraints</span></article><b>→</b><article><i>03</i><span>Task-hour screening</span></article><b>→</b><article><i>04</i><span>Candidate schedules</span></article><b>→</b><article><i>05</i><span>Validated proposal</span></article></div>
        <div className="method-headline-stats"><article><span>Peak apparent</span><strong>{peak === null ? "—" : `${peak.toFixed(1)}°C`}</strong><small>hourly site condition</small></article><article><span>Spatial range</span><strong>{cellMin === null ? "—" : `${cellMin.toFixed(1)}–${cellMax!.toFixed(1)}°C`}</strong><small>15:00 thermal cells</small></article><article><span>Operation scale</span><strong>{workspace.simulation?.job_count || 0} jobs</strong><small>{workspace.simulation?.worker_count || 0} fictional workers</small></article><article><span>Plan validity</span><strong>{workspace.analysis ? workspace.analysis.metrics.constraint_valid ? "Valid" : "Review" : "Pending"}</strong><small>{workspace.analysis ? `${workspace.analysis.metrics.disruption.hard_constraint_violations} encoded violations` : "run analysis"}</small></article></div>
      </section>

      <section className="method-section" id="method-operations"><div className="method-section-heading"><span className="eyebrow">Generated operation</span><h2>People, work and the submitted day.</h2><p>These are fictional inputs produced from the saved seed. They are deliberately large enough to make crew contention and scheduling trade-offs visible.</p></div>
        {workspace.simulation ? <><CrewGrid crews={workspace.crews} jobs={workspace.jobs} /><ScheduleBoard workspace={workspace} /><JobTable workspace={workspace} /></> : <div className="method-awaiting"><i>02</i><div><strong>No crews or jobs yet.</strong><p>Use Generate operation above. The same seed and settings reproduce the same core operation.</p></div></div>}
      </section>

      <section className="method-section" id="method-weather"><div className="method-section-heading"><span className="eyebrow">Heat evidence</span><h2>Weather describes this day. Climate describes a pattern across years.</h2><p>HeatShift schedules against hourly conditions and local spatial differences for the selected operation date. It does not treat one hot day as a climate trend.</p></div>
        <div className="weather-definition-grid"><article className="active"><i>24h</i><h3>Hourly weather</h3><p>Air temperature, apparent temperature, humidity, wet bulb and solar irradiance vary through this specific day.</p></article><article className="active"><i>100m</i><h3>Thermal field</h3><p>Cells show how heat differs across the site. Jobs inherit the offset of their nearest cell.</p></article><article><i>Years</i><h3>Climate</h3><p>Long-term averages and trends. Useful for strategy, but not an input to this day-level scheduling run.</p></article></div>
        <WeatherChart workspace={workspace} />
        <div className="weather-detail-grid"><article><span>What apparent temperature adds</span><strong>How hot conditions can feel</strong><p>It combines air temperature with atmospheric conditions. HeatShift uses it as the environmental base of the task score, then adds workload, acclimatization, PPE and sun or shade.</p></article><article><span>What the cells add</span><strong>Location inside the site</strong><p>Hourly cell value = hourly site apparent temperature + the cell&apos;s difference from the 15:00 field mean. It is a transparent reconstruction, not a worker sensor.</p></article><article><span>What the source means</span><strong>{workspace.site.curated ? "Real cached environmental evidence" : "Transparent simulated weather"}</strong><p>{workspace.site.source_label}</p></article></div>
        {evidence && <div className="surface-context"><div><span>Vegetation</span><b><i style={{ width: `${evidence.satellite_context.vegetation_percent || 0}%` }} /></b><strong>{evidence.satellite_context.vegetation_percent || 0}%</strong></div><div><span>Pavement</span><b><i style={{ width: `${evidence.satellite_context.pavement_percent || 0}%` }} /></b><strong>{evidence.satellite_context.pavement_percent || 0}%</strong></div><div><span>Buildings</span><b><i style={{ width: `${evidence.satellite_context.building_percent || 0}%` }} /></b><strong>{evidence.satellite_context.building_percent || 0}%</strong></div></div>}
      </section>

      <section className="method-section" id="method-metrics"><div className="method-section-heading"><span className="eyebrow">Decision metrics</span><h2>Heat, people and disruption stay visible as separate decisions.</h2><p>HeatShift does not hide everything in one magic score. Each metric answers a different manager question.</p></div>
        <MetricsStory workspace={workspace} />
        <div className="score-anatomy"><header><span className="eyebrow">Inside one task-hour score</span><strong>Add the conditions of the place, the work and the crew.</strong><p>The score is recalculated for each candidate start. That is how moving the same job can change its exposure without changing its duration.</p></header><div className="score-anatomy-flow"><article><span>Environment</span><strong>8–55</strong><small>apparent-temperature band</small></article><b>+</b><article><span>Workload</span><strong>4–28</strong><small>light → very heavy</small></article><b>+</b><article><span>Acclimatization</span><strong>0 / 8 / 14</strong><small>acclimatized → new</small></article><b>+</b><article><span>PPE</span><strong>0 / 7 / 14</strong><small>low → high burden</small></article><b>+</b><article><span>Sun or shade</span><strong>−10 / +10</strong><small>shade or direct solar hours</small></article><b>=</b><article className="score-result"><span>Screening score</span><strong>0–100</strong><small>50 comparison threshold</small></article></div></div>
        <div className="metric-formula-grid"><details open><summary><i>01</i><div><strong>Task-hour score</strong><span>Which work is more exposed right now?</span></div><b>+</b></summary><p>Environmental points from apparent temperature + workload + acclimatization + PPE + direct sun or shade, clamped to 0–100. A score of 50 is the disclosed comparison threshold, not a universal safety limit.</p></details><details><summary><i>02</i><div><strong>Site Thermal Burden</strong><span>How intense and persistent is the day?</span></div><b>+</b></summary><p>Σ max(0, hourly apparent temperature − 35°C) × one hour. The 35°C baseline is a configurable planning reference, not a medical threshold.</p></details><details><summary><i>03</i><div><strong>Crew Exposure Load</strong><span>How much cumulative screened load reaches crews?</span></div><b>+</b></summary><p>Σ (task score ÷ 100) × duration hours × worker count. It is a planning indicator, not a measured personal heat dose.</p></details><details><summary><i>04</i><div><strong>Operational Disruption</strong><span>What does the safer-looking plan cost operationally?</span></div><b>+</b></summary><p>Shifted minutes, crew reassignments and hard violations are shown separately. HeatShift never invents a combined disruption score.</p></details></div>
      </section>

      <section className="method-section" id="method-optimizer"><div className="method-section-heading"><span className="eyebrow">Deterministic scheduler</span><h2>A constrained search, not an AI guess.</h2><p>The same evidence, operation and policy produce the same proposal. The language model cannot set scores, move work or change official metrics.</p></div>
        <div className="optimizer-visual"><div className="optimizer-loop"><article><i>1</i><strong>Order movable jobs</strong><p>Larger crews and longer jobs are considered first.</p></article><article><i>2</i><strong>Generate candidates</strong><p>Every eligible crew and 30-minute start inside the allowed window.</p></article><article><i>3</i><strong>Reject invalid work</strong><p>No overlap, fixed move, duration change, ineligible crew or out-of-window placement.</p></article><article><i>4</i><strong>Keep an improvement</strong><p>Compare the full schedule lexicographically; repeat for at most two passes.</p></article><article><i>5</i><strong>Validate again</strong><p>Return the proposal only after every encoded hard constraint passes.</p></article></div>
          <div className="objective-ladder"><span>Optimization priority · evaluated in this order</span><ol><li><b>01</b><div><strong>High-risk worker-minutes</strong><small>Score 50 or above</small></div></li><li><b>02</b><div><strong>Total Crew Exposure Load</strong><small>Across all crews</small></div></li><li><b>03</b><div><strong>Highest individual crew load</strong><small>Avoid concentrating burden</small></div></li><li><b>04</b><div><strong>Minutes shifted</strong><small>Reduce operational movement</small></div></li><li><b>05</b><div><strong>Crew reassignments</strong><small>Preserve the submitted team</small></div></li></ol></div></div>
        <div className="constraint-strip"><span>Every proposal must keep</span><b>Every job exactly once</b><b>Fixed jobs unchanged</b><b>Duration unchanged</b><b>Eligible crews only</b><b>No crew overlaps</b><b>Allowed time windows</b></div>
        <div className="optimizer-boundary"><strong>What “optimized” means here</strong><p>HeatShift returns the best validated schedule found by its deterministic two-pass local search. It does not claim a mathematical global optimum, and it cannot validate site rules that were never encoded.</p></div>
      </section>

      <section className="method-section method-briefing-section" id="method-briefing"><div className="method-section-heading"><span className="eyebrow">Narrative layer</span><h2>Explanation follows the calculation.</h2><p>AI may enrich simulated activity names when available. Official schedules, scores and metrics remain deterministic, and the briefing is constrained to explain them.</p></div>
        {workspace.analysis ? <div className="method-briefing-card"><header><span>HS</span><div><strong>Operational briefing</strong><small>{workspace.simulation?.generation_mode === "ai_enriched_stochastic" ? "AI-enriched simulation labels" : "Deterministic fallback active"}</small></div></header><div className="briefing-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{workspace.analysis.briefing_markdown}</ReactMarkdown></div><footer>Screening-level planning support. Verify conditions on site and apply qualified safety judgment.</footer></div> : <div className="method-awaiting"><i>AI</i><div><strong>No result to explain yet.</strong><p>Run analysis first. The narrative layer will summarize the official deterministic result; it will not create a second answer.</p></div></div>}
      </section>
    </main>
  </div>;
}
