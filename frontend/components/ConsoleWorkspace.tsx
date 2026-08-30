"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import DecisionSummary from "@/components/DecisionSummary";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import GlassesView from "@/components/GlassesView";
import RecommendationPanel from "@/components/RecommendationPanel";
import RiskSummary from "@/components/RiskSummary";
import ShiftTimeline from "@/components/ShiftTimeline";
import SiteMap from "@/components/SiteMap";
import {
  getDemoScenario,
  runDemo,
  runScenario,
  type AnalysisResult,
  type Crew,
  type ScenarioPayload,
  type Task,
} from "@/lib/api";

type EditorTab = "setup" | "crews" | "tasks";

const STORAGE_KEY = "heatshift-scenario-v1";
const LOADING_STEPS = ["Reading environmental evidence", "Calculating exposure", "Checking legal alternatives", "Preparing the decision brief"];

function cloneScenario(value: ScenarioPayload): ScenarioPayload {
  return JSON.parse(JSON.stringify(value)) as ScenarioPayload;
}

function timeValue(timestamp: string) {
  return timestamp.slice(11, 16);
}

function timestampFor(date: string, time: string, source: string) {
  const offset = source.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] ?? "-07:00";
  return `${date}T${time}:00${offset}`;
}

function minuteOfDay(timestamp: string) {
  const [hour, minute] = timeValue(timestamp).split(":").map(Number);
  return hour * 60 + minute;
}

function validateScenario(scenario: ScenarioPayload) {
  if (!scenario.site.name.trim()) return "Add a worksite name.";
  if (!scenario.shift.shift_id.trim()) return "Add a scenario name.";
  if (scenario.crews.length === 0) return "Add at least one crew.";
  if (scenario.shift.tasks.length === 0) return "Add at least one task.";
  const shiftStart = minuteOfDay(scenario.shift.shift_start);
  const shiftEnd = minuteOfDay(scenario.shift.shift_end);
  if (shiftStart >= shiftEnd) return "Shift end must be later than shift start.";
  const crewIds = new Set(scenario.crews.map((crew) => crew.crew_id));
  const taskById = new Map(scenario.shift.tasks.map((task) => [task.task_id, task]));
  for (const task of scenario.shift.tasks) {
    if (!task.name.trim()) return "Every task needs a name.";
    if (!crewIds.has(task.crew_id)) return `${task.name} needs an assigned crew.`;
    const scheduled = minuteOfDay(task.scheduled_start);
    const earliest = minuteOfDay(task.earliest_start);
    const latest = minuteOfDay(task.latest_finish);
    if (scheduled < earliest) return `${task.name} starts before its earliest allowed time.`;
    if (scheduled + task.duration_minutes > latest) return `${task.name} does not finish inside its allowed window.`;
    if (scheduled < shiftStart || scheduled + task.duration_minutes > shiftEnd) return `${task.name} falls outside the shift.`;
    for (const dependencyId of task.dependencies) {
      const dependency = taskById.get(dependencyId);
      if (!dependency) return `${task.name} references a task that no longer exists.`;
      if (minuteOfDay(dependency.scheduled_start) + dependency.duration_minutes > scheduled) return `${task.name} starts before ${dependency.name} finishes.`;
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasDependencyCycle = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    const cyclic = (taskById.get(taskId)?.dependencies ?? []).some(hasDependencyCycle);
    visiting.delete(taskId); visited.add(taskId);
    return cyclic;
  };
  if (scenario.shift.tasks.some((task) => hasDependencyCycle(task.task_id))) return "Task dependencies contain a cycle.";

  for (const crew of scenario.crews) {
    const tasks = scenario.shift.tasks.filter((task) => task.crew_id === crew.crew_id).sort((left, right) => minuteOfDay(left.scheduled_start) - minuteOfDay(right.scheduled_start));
    for (let index = 1; index < tasks.length; index += 1) {
      const previous = tasks[index - 1]; const current = tasks[index];
      if (minuteOfDay(previous.scheduled_start) + previous.duration_minutes > minuteOfDay(current.scheduled_start)) return `${crew.name} has overlapping baseline tasks.`;
    }
  }
  return null;
}

function EnvironmentalStrip({ analysis }: { analysis: AnalysisResult }) {
  const values = analysis.observations.map((item) => item.apparent_temperature_c || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (
    <div className="environment-strip">
      <div className="strip-label"><span>Hourly apparent temperature</span><strong>{min.toFixed(1)}–{max.toFixed(1)}°C</strong></div>
      <div className="temperature-bars">
        {analysis.observations.map((item, index) => {
          const value = item.apparent_temperature_c || min;
          const height = 28 + ((value - min) / Math.max(max - min, 1)) * 52;
          return <div className="temperature-hour" key={item.timestamp}><span className="temperature-value">{value.toFixed(0)}°</span><i style={{ height: `${height}%` }} /><small>{index % 2 === 0 ? item.timestamp.slice(11, 13) : ""}</small></div>;
        })}
      </div>
      <div className="strip-axis"><span>06:00</span><span>Local time · GMT−7</span><span>16:00</span></div>
    </div>
  );
}

function AnalysisWorkspace({ analysis }: { analysis: AnalysisResult }) {
  return (
    <div className="console-results" aria-live="polite">
      <div className="console-result-head">
        <div><span className="verified-badge"><i>✓</i> Analysis complete</span><h1>{analysis.site.name}</h1><p>{analysis.data_provenance.source_label}</p></div>
        <div className="result-id"><span>Analysis</span><code>{analysis.analysis_id.slice(0, 8)}</code></div>
      </div>
      <RiskSummary metrics={analysis.metrics} />
      <DecisionSummary analysis={analysis} />
      <section className="map-and-environment">
        <SiteMap heatmap={analysis.heatmap_geojson} site={analysis.site} tasks={analysis.tasks} schedule={analysis.optimized_schedule} />
        <aside className="panel conditions-panel">
          <div className="panel-header compact"><div><span className="eyebrow">{analysis.observations.length} hourly observations</span><h2>Shift conditions</h2></div><span className="data-badge">FG</span></div>
          <EnvironmentalStrip analysis={analysis} />
          <div className="conditions-grid">
            <div><span>Wet bulb peak</span><strong>{Math.max(...analysis.observations.map((item) => item.wet_bulb_temperature_c || 0)).toFixed(1)}°C</strong></div>
            <div><span>Humidity range</span><strong>{Math.min(...analysis.observations.map((item) => item.relative_humidity_percent || 0)).toFixed(1)}–{Math.max(...analysis.observations.map((item) => item.relative_humidity_percent || 0)).toFixed(1)}%</strong></div>
            <div><span>Clear-sky GHI</span><strong>{Math.max(...analysis.observations.map((item) => item.solar_irradiance_ghi_wm2 || 0)).toFixed(0)} W/m²</strong></div>
            <div><span>Spatial spread</span><strong>0.09°C</strong></div>
          </div>
          <div className="conditions-note"><span>!</span><p>Apparent temperature drives screening. Thermal-field temperature is displayed separately.</p></div>
        </aside>
      </section>
      <ShiftTimeline baseline={analysis.baseline_schedule} optimized={analysis.optimized_schedule} movements={analysis.movements} />
      <section className="actions-layout"><RecommendationPanel recommendations={analysis.recommendations} /><GlassesView alerts={analysis.worker_alerts} /></section>
      <section className="panel agent-brief">
        <div className="agent-symbol"><span>AI</span><i /></div>
        <div><span className="eyebrow">Orchestration result · {analysis.agent?.mode.replaceAll("_", " ")}</span><h2>Agent briefing</h2><p>{analysis.agent?.explanation}</p></div>
        <div className="agent-stat"><strong>{analysis.agent?.tool_trace.length}</strong><span>validated<br />tool calls</span></div>
      </section>
      <EvidenceDrawer analysis={analysis} />
      <section className="safety-banner"><span>!</span><p><strong>Screening-level decision support.</strong> This result does not replace an on-site WBGT meter, emergency procedures, or a qualified safety professional.</p></section>
    </div>
  );
}

interface SidebarProps {
  scenario: ScenarioPayload;
  tab: EditorTab;
  loading: boolean;
  dirty: boolean;
  error: string | null;
  onTab: (tab: EditorTab) => void;
  onScenario: (scenario: ScenarioPayload) => void;
  onRun: () => void;
  onReset: () => void;
  onNew: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
}

function ScenarioSidebar({ scenario, tab, loading, dirty, error, onTab, onScenario, onRun, onReset, onNew, onImport, onExport }: SidebarProps) {
  const update = (mutator: (next: ScenarioPayload) => void) => {
    const next = cloneScenario(scenario);
    mutator(next);
    onScenario(next);
  };
  const updateCrew = (index: number, values: Partial<Crew>) => update((next) => Object.assign(next.crews[index], values));
  const updateTask = (index: number, values: Partial<Task>) => update((next) => Object.assign(next.shift.tasks[index], values));
  const addCrew = () => update((next) => {
    const count = next.crews.length + 1;
    next.crews.push({ crew_id: `crew-${Date.now()}`, name: `Crew ${count}`, worker_count: 1, acclimatization_status: "acclimatized", ppe_level: "low", default_workload: "moderate" });
  });
  const removeCrew = (index: number) => update((next) => {
    const id = next.crews[index].crew_id;
    if (next.shift.tasks.some((task) => task.crew_id === id)) throw new Error("Reassign this crew's tasks before removing it.");
    next.crews.splice(index, 1);
  });
  const addTask = () => update((next) => {
    const crew = next.crews[0];
    if (!crew) return;
    const id = `task-${Date.now()}`;
    next.shift.tasks.push({ task_id: id, name: "New task", crew_id: crew.crew_id, location: { ...next.site.cooling_zone_coordinates }, duration_minutes: 60, workload: "moderate", scheduled_start: timestampFor(next.shift.date, "08:00", next.shift.shift_start), earliest_start: timestampFor(next.shift.date, "06:00", next.shift.shift_start), latest_finish: timestampFor(next.shift.date, "16:00", next.shift.shift_end), movable: true, dependencies: [], shaded: false });
  });
  const removeTask = (index: number) => update((next) => {
    const id = next.shift.tasks[index].task_id;
    next.shift.tasks.splice(index, 1);
    next.shift.tasks.forEach((task) => { task.dependencies = task.dependencies.filter((dependency) => dependency !== id); });
  });

  return (
    <aside className="scenario-sidebar">
      <div className="scenario-sidebar-top">
        <div><span className="eyebrow">Scenario workspace</span><h2>Build the shift</h2></div>
        <span className={`save-state${dirty ? " dirty" : ""}`}><i /> {dirty ? "Saved locally" : "Reference loaded"}</span>
      </div>
      <div className="scenario-file-actions">
        <button type="button" onClick={onNew}>New</button>
        <label>Import<input type="file" accept="application/json,.json" onChange={onImport} /></label>
        <button type="button" onClick={onExport}>Export</button>
        <button type="button" onClick={onReset}>Reset</button>
      </div>
      <div className="editor-tabs" role="tablist" aria-label="Scenario sections">
        <button type="button" role="tab" aria-selected={tab === "setup"} onClick={() => onTab("setup")}>Setup</button>
        <button type="button" role="tab" aria-selected={tab === "crews"} onClick={() => onTab("crews")}>Crews <b>{scenario.crews.length}</b></button>
        <button type="button" role="tab" aria-selected={tab === "tasks"} onClick={() => onTab("tasks")}>Tasks <b>{scenario.shift.tasks.length}</b></button>
      </div>
      <div className="scenario-editor">
        {tab === "setup" && <div className="editor-section">
          <div className="editor-note"><span>FG</span><p><strong>Phoenix reference environment</strong>Custom fictional operations are evaluated against the pinned real FortyGuard replay. Geography and 06:00–16:00 window remain fixed in this proof of concept.</p></div>
          <label><span>Scenario name</span><input value={scenario.shift.shift_id} onChange={(event) => update((next) => { next.shift.shift_id = event.target.value; })} /></label>
          <label><span>Worksite name</span><input value={scenario.site.name} onChange={(event) => update((next) => { next.site.name = event.target.value; })} /></label>
          <div className="field-pair">
            <label><span>Shift start</span><input type="time" min="06:00" max="16:00" step="1800" value={timeValue(scenario.shift.shift_start)} onChange={(event) => update((next) => { next.shift.shift_start = timestampFor(next.shift.date, event.target.value, next.shift.shift_start); })} /></label>
            <label><span>Shift end</span><input type="time" min="06:00" max="16:00" step="1800" value={timeValue(scenario.shift.shift_end)} onChange={(event) => update((next) => { next.shift.shift_end = timestampFor(next.shift.date, event.target.value, next.shift.shift_end); })} /></label>
          </div>
          <label><span>Surface type</span><input value={scenario.site.surface_type} onChange={(event) => update((next) => { next.site.surface_type = event.target.value; })} /></label>
          <div className="field-pair">
            <label><span>Cooling longitude</span><input type="number" step="0.0001" value={scenario.site.cooling_zone_coordinates.longitude} onChange={(event) => update((next) => { next.site.cooling_zone_coordinates.longitude = Number(event.target.value); })} /></label>
            <label><span>Cooling latitude</span><input type="number" step="0.0001" value={scenario.site.cooling_zone_coordinates.latitude} onChange={(event) => update((next) => { next.site.cooling_zone_coordinates.latitude = Number(event.target.value); })} /></label>
          </div>
        </div>}

        {tab === "crews" && <div className="editor-section collection-section">
          {scenario.crews.map((crew, index) => <details className="editor-card" open={index === 0} key={crew.crew_id}>
            <summary><span><i>{String(index + 1).padStart(2, "0")}</i><strong>{crew.name}</strong><small>{crew.worker_count} worker{crew.worker_count === 1 ? "" : "s"} · {crew.ppe_level} PPE</small></span><b>⌄</b></summary>
            <div className="editor-card-body">
              <label><span>Crew name</span><input value={crew.name} onChange={(event) => updateCrew(index, { name: event.target.value })} /></label>
              <label><span>Worker count</span><input type="number" min="1" max="100" value={crew.worker_count} onChange={(event) => updateCrew(index, { worker_count: Number(event.target.value) })} /></label>
              <label><span>Acclimatization</span><select value={crew.acclimatization_status} onChange={(event) => updateCrew(index, { acclimatization_status: event.target.value })}><option value="new">New</option><option value="returning">Returning</option><option value="acclimatized">Acclimatized</option></select></label>
              <label><span>PPE burden</span><select value={crew.ppe_level} onChange={(event) => updateCrew(index, { ppe_level: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
              <label><span>Default workload</span><select value={crew.default_workload} onChange={(event) => updateCrew(index, { default_workload: event.target.value })}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
              <button className="remove-editor-item" type="button" onClick={() => { try { removeCrew(index); } catch (caught) { window.alert(caught instanceof Error ? caught.message : "Crew cannot be removed."); } }}>Remove crew</button>
            </div>
          </details>)}
          <button className="add-editor-item" type="button" onClick={addCrew}>+ Add crew</button>
        </div>}

        {tab === "tasks" && <div className="editor-section collection-section">
          {scenario.shift.tasks.map((task, index) => <details className="editor-card" open={index === 0} key={task.task_id}>
            <summary><span><i>{String(index + 1).padStart(2, "0")}</i><strong>{task.name}</strong><small>{task.duration_minutes} min · {task.workload.replace("_", " ")}</small></span><b>⌄</b></summary>
            <div className="editor-card-body">
              <label><span>Task name</span><input value={task.name} onChange={(event) => updateTask(index, { name: event.target.value })} /></label>
              <label><span>Crew</span><select value={task.crew_id} onChange={(event) => updateTask(index, { crew_id: event.target.value })}>{scenario.crews.map((crew) => <option value={crew.crew_id} key={crew.crew_id}>{crew.name}</option>)}</select></label>
              <div className="field-pair"><label><span>Duration (min)</span><input type="number" min="30" max="720" step="30" value={task.duration_minutes} onChange={(event) => updateTask(index, { duration_minutes: Number(event.target.value) })} /></label><label><span>Workload</span><select value={task.workload} onChange={(event) => updateTask(index, { workload: event.target.value })}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label></div>
              <div className="field-pair"><label><span>Scheduled</span><input type="time" min="06:00" max="16:00" step="1800" value={timeValue(task.scheduled_start)} onChange={(event) => updateTask(index, { scheduled_start: timestampFor(scenario.shift.date, event.target.value, task.scheduled_start) })} /></label><label><span>Earliest</span><input type="time" min="06:00" max="16:00" step="1800" value={timeValue(task.earliest_start)} onChange={(event) => updateTask(index, { earliest_start: timestampFor(scenario.shift.date, event.target.value, task.earliest_start) })} /></label></div>
              <label><span>Latest finish</span><input type="time" min="06:00" max="16:00" step="1800" value={timeValue(task.latest_finish)} onChange={(event) => updateTask(index, { latest_finish: timestampFor(scenario.shift.date, event.target.value, task.latest_finish) })} /></label>
              <div className="field-pair"><label><span>Longitude</span><input type="number" step="0.0001" value={task.location.longitude} onChange={(event) => updateTask(index, { location: { ...task.location, longitude: Number(event.target.value) } })} /></label><label><span>Latitude</span><input type="number" step="0.0001" value={task.location.latitude} onChange={(event) => updateTask(index, { location: { ...task.location, latitude: Number(event.target.value) } })} /></label></div>
              <label><span>Dependencies</span><select multiple value={task.dependencies} onChange={(event) => updateTask(index, { dependencies: Array.from(event.target.selectedOptions, (option) => option.value) })}>{scenario.shift.tasks.filter((candidate) => candidate.task_id !== task.task_id).map((candidate) => <option value={candidate.task_id} key={candidate.task_id}>{candidate.name}</option>)}</select><small>Use Ctrl/Cmd to select more than one.</small></label>
              <div className="toggle-row"><label><input type="checkbox" checked={task.movable} onChange={(event) => updateTask(index, { movable: event.target.checked })} /><span>Movable</span></label><label><input type="checkbox" checked={task.shaded} onChange={(event) => updateTask(index, { shaded: event.target.checked })} /><span>Shaded</span></label></div>
              <button className="remove-editor-item" type="button" onClick={() => removeTask(index)} disabled={scenario.shift.tasks.length === 1}>Remove task</button>
            </div>
          </details>)}
          <button className="add-editor-item" type="button" onClick={addTask}>+ Add task</button>
        </div>}
      </div>
      <div className="scenario-run-area">
        {error && <p className="sidebar-error" role="alert">{error}</p>}
        <button className="scenario-run-button" type="button" onClick={onRun} disabled={loading}><span>{loading ? <i className="button-spinner" /> : "↗"}</span><span><strong>{loading ? "Analyzing scenario" : "Run analysis"}</strong><small>Screen → optimize → explain</small></span></button>
      </div>
    </aside>
  );
}

export default function ConsoleWorkspace() {
  const [scenario, setScenario] = useState<ScenarioPayload | null>(null);
  const [defaultScenario, setDefaultScenario] = useState<ScenarioPayload | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [tab, setTab] = useState<EditorTab>("setup");
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileInputReset = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const demo = await getDemoScenario(controller.signal);
        const reference: ScenarioPayload = { site: demo.site, crews: demo.crews, shift: demo.shift, environment_source: "phoenix_reference" };
        setDefaultScenario(reference);
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const initial = stored ? JSON.parse(stored) as ScenarioPayload : reference;
        setScenario(initial);
        setDirty(Boolean(stored));
        setAnalysis(stored ? await runScenario(initial, controller.signal) : await runDemo(controller.signal));
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The console could not be initialized.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!scenario || !dirty) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scenario));
  }, [scenario, dirty]);

  const runCurrentScenario = useCallback(async () => {
    if (!scenario) return;
    const validationError = validateScenario(scenario);
    if (validationError) { setError(validationError); return; }
    setLoading(true); setError(null); setLoadingStep(0);
    const ticker = window.setInterval(() => setLoadingStep((step) => Math.min(step + 1, LOADING_STEPS.length - 1)), 600);
    try { setAnalysis(await runScenario(scenario)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The analysis could not be completed."); }
    finally { window.clearInterval(ticker); setLoading(false); }
  }, [scenario]);

  const changeScenario = (next: ScenarioPayload) => { setScenario(next); setAnalysis(null); setDirty(true); setError(null); };
  const resetScenario = async () => {
    if (!defaultScenario) return;
    window.localStorage.removeItem(STORAGE_KEY); setScenario(cloneScenario(defaultScenario)); setDirty(false); setError(null); setLoading(true);
    try { setAnalysis(await runDemo()); } catch (caught) { setError(caught instanceof Error ? caught.message : "The reference scenario could not be restored."); } finally { setLoading(false); }
  };
  const newScenario = () => {
    if (!defaultScenario) return;
    const now = Date.now();
    const next = cloneScenario(defaultScenario);
    const crewId = `crew-${now}`;
    next.site.name = "Untitled fictional operation";
    next.site.surface_type = "paved outdoor worksite";
    next.shift.shift_id = `scenario-${now}`;
    next.crews = [{ crew_id: crewId, name: "Crew 1", worker_count: 1, acclimatization_status: "acclimatized", ppe_level: "low", default_workload: "moderate" }];
    next.shift.tasks = [{
      task_id: `task-${now}`,
      name: "New task",
      crew_id: crewId,
      location: { ...next.site.cooling_zone_coordinates },
      duration_minutes: 60,
      workload: "moderate",
      scheduled_start: timestampFor(next.shift.date, "08:00", next.shift.shift_start),
      earliest_start: timestampFor(next.shift.date, "06:00", next.shift.shift_start),
      latest_finish: timestampFor(next.shift.date, "16:00", next.shift.shift_end),
      movable: true,
      dependencies: [],
      shaded: false,
    }];
    setScenario(next); setAnalysis(null); setDirty(true); setError(null); setTab("setup");
  };
  const importScenario = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as ScenarioPayload;
      if (!parsed.site || !Array.isArray(parsed.crews) || !parsed.shift?.tasks) throw new Error("This file is not a HeatShift scenario export.");
      parsed.environment_source = "phoenix_reference"; setScenario(parsed); setAnalysis(null); setDirty(true); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Scenario import failed."); }
    fileInputReset.current += 1; event.target.value = "";
  };
  const exportScenario = () => {
    if (!scenario) return;
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName = (scenario.shift.shift_id || "heatshift-scenario").replace(/[^a-z0-9_-]+/gi, "-");
    anchor.href = url; anchor.download = `${safeName}.json`; anchor.hidden = true;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  if (!scenario) return <section className="console-initializing" aria-live="polite"><div className="loading-orbit"><i /><i /><i /></div><span className="eyebrow">Preparing console</span><h1>{error ?? LOADING_STEPS[loadingStep]}</h1></section>;

  return (
    <section className="console-shell">
      <ScenarioSidebar scenario={scenario} tab={tab} loading={loading} dirty={dirty} error={error} onTab={setTab} onScenario={changeScenario} onRun={() => void runCurrentScenario()} onReset={() => void resetScenario()} onNew={newScenario} onImport={(event) => void importScenario(event)} onExport={exportScenario} />
      <div className="console-main">
        {loading && <div className="console-loading" aria-live="polite"><div className="loading-orbit"><i /><i /><i /></div><div><span className="eyebrow">Deterministic workflow</span><strong>{LOADING_STEPS[loadingStep]}</strong></div></div>}
        {analysis ? <AnalysisWorkspace analysis={analysis} /> : <div className="console-empty"><span>↗</span><h1>Build a scenario, then run the analysis.</h1><p>Your operation stays in this browser. Only the validated scenario is sent to the analysis API.</p></div>}
      </div>
    </section>
  );
}
