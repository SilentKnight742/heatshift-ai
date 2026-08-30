"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import GlassesView from "@/components/GlassesView";
import HeatshieldValidationPanel from "@/components/HeatshieldValidationPanel";
import RecommendationPanel from "@/components/RecommendationPanel";
import RiskSummary from "@/components/RiskSummary";
import ShiftTimeline from "@/components/ShiftTimeline";
import { runDemo, type AnalysisResult } from "@/lib/api";

const SiteMap = dynamic(() => import("@/components/SiteMap"), {
  ssr: false,
  loading: () => <div className="panel map-loading">Initializing thermal map…</div>,
});

const LOADING_STEPS = [
  "Retrieving FortyGuard evidence",
  "Calculating crew exposure",
  "Optimizing movable work",
  "Formatting worker alerts",
];

function EnvironmentalStrip({ analysis }: { analysis: AnalysisResult }) {
  const values = analysis.observations.map((item) => item.apparent_temperature_c || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (
    <div className="environment-strip">
      <div className="strip-label">
        <span>Hourly apparent temperature</span>
        <strong>{min.toFixed(1)}–{max.toFixed(1)}°C</strong>
      </div>
      <div className="temperature-bars">
        {analysis.observations.map((item, index) => {
          const value = item.apparent_temperature_c || min;
          const height = 28 + ((value - min) / Math.max(max - min, 1)) * 52;
          return (
            <div className="temperature-hour" key={item.timestamp}>
              <span className="temperature-value">{value.toFixed(0)}°</span>
              <i style={{ height: `${height}%` }} />
              <small>{index % 2 === 0 ? item.timestamp.slice(11, 13) : ""}</small>
            </div>
          );
        })}
      </div>
      <div className="strip-axis"><span>06:00</span><span>Local time · GMT−7</span><span>16:00</span></div>
    </div>
  );
}

export default function Home() {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const initialRun = useRef(false);

  const startAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadingStep(0);
    const controller = new AbortController();
    const ticker = window.setInterval(
      () => setLoadingStep((step) => Math.min(step + 1, LOADING_STEPS.length - 1)),
      650,
    );
    try {
      const result = await runDemo(controller.signal);
      setAnalysis(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The analysis could not be completed.");
    } finally {
      window.clearInterval(ticker);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialRun.current) return;
    initialRun.current = true;
    void startAnalysis();
  }, [startAnalysis]);

  return (
    <main>
      <header className="app-header">
        <a className="brand" href="#top" aria-label="HeatShift AI home">
          <span className="brand-mark"><i /><b>H</b></span>
          <span><strong>HeatShift AI</strong><small>Industrial heat operations</small></span>
        </a>
        <nav aria-label="Page sections">
          <a href="#overview">Overview</a>
          <a href="#schedule">Shift plan</a>
          <a href="#alerts">Worker alert</a>
          <a href="#validation">Validation</a>
        </nav>
        <div className="header-status">
          <span><i /> System ready</span>
          <b>SCREENING SUPPORT</b>
        </div>
      </header>

      <div className="page-shell" id="top">
        <section className="hero">
          <div className="hero-copy">
            <span className="hero-kicker"><i /> Phoenix replay · Aug 28, 2026</span>
            <h1>Protect the shift<br />before <em>heat</em> reshapes it.</h1>
            <p>Turn hyperlocal thermal evidence into a safer, constraint-checked work plan—before crews clock in.</p>
          </div>
          <div className="hero-aside">
            <span className="aside-number">12</span>
            <p>fictional workers<br />across three crews</p>
            <div><i /><i /><i /></div>
          </div>
        </section>

        <section className="scenario-panel panel" id="overview">
          <div className="scenario-fields">
            <label><span>Worksite</span><strong>DesertLine Logistics Yard</strong><small>Phoenix, Arizona · fictional operation</small></label>
            <label><span>Replay date</span><strong>28 Aug 2026</strong><small>Friday · historical</small></label>
            <label><span>Shift window</span><strong>06:00 — 16:00</strong><small>America / Phoenix</small></label>
            <label><span>Data source</span><strong>FortyGuard</strong><small>{analysis ? (analysis.data_provenance.mode === "live" ? "Live response" : "Verified real cache") : "Checking source…"}</small></label>
          </div>
          <button className="run-button" onClick={() => void startAnalysis()} disabled={loading}>
            <span>{loading ? <i className="button-spinner" /> : "↗"}</span>
            <span><strong>{loading ? LOADING_STEPS[loadingStep] : "Run HeatShift Analysis"}</strong><small>{loading ? "Deterministic workflow in progress" : "Retrieve → screen → optimize → alert"}</small></span>
          </button>
        </section>

        {error && (
          <section className="error-panel panel">
            <strong>Analysis unavailable</strong><p>{error}</p><button onClick={() => void startAnalysis()}>Retry analysis</button>
          </section>
        )}

        {!analysis && !error && (
          <section className="loading-stage panel" aria-live="polite">
            <div className="loading-orbit"><i /><i /><i /></div>
            <div><span className="eyebrow">Analysis in progress</span><h2>{LOADING_STEPS[loadingStep]}</h2><p>Using the completed FortyGuard Phoenix replay and policy v1.0.0.</p></div>
            <div className="loading-progress">{LOADING_STEPS.map((step, index) => <i className={index <= loadingStep ? "active" : ""} key={step} />)}</div>
          </section>
        )}

        {analysis && (
          <>
            <div className="analysis-statusline">
              <span className="verified-badge"><i>✓</i> Analysis complete</span>
              <p>{analysis.data_provenance.source_label}</p>
              <code>ID {analysis.analysis_id.slice(0, 8)}</code>
            </div>

            <RiskSummary metrics={analysis.metrics} />

            <section className="map-and-environment">
              <SiteMap heatmap={analysis.heatmap_geojson} site={analysis.site} tasks={analysis.tasks} schedule={analysis.optimized_schedule} />
              <aside className="panel conditions-panel">
                <div className="panel-header compact"><div><span className="eyebrow">11 hourly observations</span><h2>Shift conditions</h2></div><span className="data-badge">FG</span></div>
                <EnvironmentalStrip analysis={analysis} />
                <div className="conditions-grid">
                  <div><span>Wet bulb peak</span><strong>{Math.max(...analysis.observations.map((item) => item.wet_bulb_temperature_c || 0)).toFixed(1)}°C</strong></div>
                  <div><span>Humidity range</span><strong>14.9–55.7%</strong></div>
                  <div><span>Clear-sky GHI</span><strong>{analysis.observations[0].solar_irradiance_ghi_wm2?.toFixed(0)} W/m²</strong></div>
                  <div><span>Spatial spread</span><strong>0.09°C</strong></div>
                </div>
                <div className="conditions-note"><span>!</span><p>Apparent temperature drives screening risk. The heatmap temperature is shown separately.</p></div>
              </aside>
            </section>

            <div id="schedule"><ShiftTimeline baseline={analysis.baseline_schedule} optimized={analysis.optimized_schedule} movements={analysis.movements} /></div>

            <section className="actions-layout" id="alerts">
              <RecommendationPanel recommendations={analysis.recommendations} />
              <GlassesView alerts={analysis.worker_alerts} />
            </section>

            <section className="panel agent-brief">
              <div className="agent-symbol"><span>AI</span><i /></div>
              <div><span className="eyebrow">Orchestration result · {analysis.agent?.mode.replaceAll("_", " ")}</span><h2>Agent briefing</h2><p>{analysis.agent?.explanation}</p></div>
              <div className="agent-stat"><strong>{analysis.agent?.tool_trace.length}</strong><span>validated<br />tool calls</span></div>
            </section>

            <EvidenceDrawer analysis={analysis} />

            <section className="safety-banner">
              <span>!</span><p><strong>Screening-level decision support.</strong> HeatShift does not replace an on-site WBGT meter, emergency procedures, or a qualified safety professional.</p>
            </section>
          </>
        )}

        <HeatshieldValidationPanel />
      </div>

      <footer><span>HEATSHIFT AI · HACKATHON VERTICAL SLICE</span><span>Real FortyGuard data · Fictional operation · Deterministic policy</span></footer>
    </main>
  );
}
