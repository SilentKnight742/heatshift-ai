"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/api";

interface Props {
  analysis: AnalysisResult;
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export default function EvidenceDrawer({ analysis }: Props) {
  const [open, setOpen] = useState(false);
  const highest = [...analysis.baseline_schedule].sort((a, b) => b.peak_risk - a.peak_risk)[0];

  return (
    <>
      <button className="evidence-trigger" onClick={() => setOpen(true)}>
        <span>⌁</span>
        <span><small>Audit trail</small><strong>Open evidence drawer</strong></span>
        <b>{analysis.agent?.tool_trace.length || 0} tool calls</b>
      </button>
      {open && <button className="drawer-backdrop" aria-label="Close evidence drawer" onClick={() => setOpen(false)} />}
      <aside className={`evidence-drawer ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="drawer-header">
          <div><span className="eyebrow">Auditable by design</span><h2>Evidence & provenance</h2></div>
          <button onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="drawer-content">
          <section className="evidence-block source-block">
            <div className="block-title"><span>01</span><strong>FortyGuard source</strong></div>
            <p className="source-label"><i /> {analysis.data_provenance.source_label}</p>
            <dl>
              <div><dt>Heatmap activity</dt><dd title={analysis.data_provenance.heatmap_activity_id}>{shortId(analysis.data_provenance.heatmap_activity_id)}</dd></div>
              <div><dt>Environment activity</dt><dd title={analysis.data_provenance.environmental_activity_id}>{shortId(analysis.data_provenance.environmental_activity_id)}</dd></div>
              <div><dt>Heatmap cells</dt><dd>198 @ 100 m</dd></div>
              <div><dt>Replay range</dt><dd>06:00–16:00 · GMT−7</dd></div>
            </dl>
          </section>

          <section className="evidence-block">
            <div className="block-title"><span>02</span><strong>Parameters used</strong></div>
            <div className="parameter-grid">
              <span>Apparent temperature</span><b>{analysis.metrics.peak_apparent_temperature_c.toFixed(1)}°C peak</b>
              <span>Wet-bulb temperature</span><b>{Math.max(...analysis.observations.map((o) => o.wet_bulb_temperature_c || 0)).toFixed(1)}°C peak</b>
              <span>Relative humidity</span><b>{Math.max(...analysis.observations.map((o) => o.relative_humidity_percent || 0)).toFixed(1)}% peak</b>
              <span>Clear-sky GHI</span><b>{analysis.observations[0].solar_irradiance_ghi_wm2?.toFixed(0)} W/m² avg</b>
            </div>
          </section>

          <section className="evidence-block">
            <div className="block-title"><span>03</span><strong>Peak risk factors</strong></div>
            <p className="factor-heading">{highest.task_name} · score {highest.peak_risk}/100</p>
            <div className="factor-list">
              {highest.risk_factors.map((factor) => (
                <div key={factor.name}>
                  <span><i style={{ width: `${Math.min(Math.abs(factor.points) * 1.6, 100)}%` }} /></span>
                  <p><strong>{factor.name.replaceAll("_", " ")}</strong><small>{factor.detail}</small></p>
                  <b>{factor.points > 0 ? "+" : ""}{factor.points}</b>
                </div>
              ))}
            </div>
            <small className="policy-version">Deterministic policy v{analysis.policy_version} · clamped 0–100</small>
          </section>

          <section className="evidence-block">
            <div className="block-title"><span>04</span><strong>Agent tool trace</strong></div>
            <p className="agent-mode">Mode · {analysis.agent?.mode.replaceAll("_", " ")}</p>
            <div className="trace-list">
              {analysis.agent?.tool_trace.map((trace) => (
                <article key={trace.sequence}>
                  <span>{String(trace.sequence).padStart(2, "0")}</span>
                  <div><strong>{trace.tool}</strong><p>{trace.summary}</p></div>
                  <b className={trace.success ? "trace-ok" : "trace-fail"}>{trace.success ? "✓" : "!"}</b>
                </article>
              ))}
            </div>
          </section>

          <section className="evidence-block limitations-block">
            <div className="block-title"><span>05</span><strong>Guidance & limitations</strong></div>
            <a href="https://www.cdc.gov/niosh/heat-stress/recommendations/index.html" target="_blank" rel="noreferrer">NIOSH workplace heat-stress recommendations ↗</a>
            <a href="https://www.cdc.gov/niosh/heat-stress/recommendations/acclimatization.html" target="_blank" rel="noreferrer">NIOSH acclimatization guidance ↗</a>
            <ul>{analysis.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
          </section>
        </div>
      </aside>
    </>
  );
}

