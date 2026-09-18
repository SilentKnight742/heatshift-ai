"use client";

import { useEffect } from "react";

export default function ConsoleGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);

  if (!open) return null;
  return <div className="console-guide-backdrop" role="dialog" aria-modal="true" aria-label="HeatShift console guide">
    <section className="console-guide-card">
      <header>
        <div><span className="eyebrow">Three steps · one operation day</span><h2>From a location to a reviewed plan.</h2><p>Follow the same path whether you use a built-in example or make a site of your own.</p></div>
        <button type="button" onClick={onClose} aria-label="Close console guide">×</button>
      </header>
      <div className="guide-step-flow">
        <article tabIndex={0}>
          <span>01</span><i>⌖</i><h3>Choose the site</h3><p>Pick a built-in site or create one from a map point or coordinates.</p>
          <div><strong>What appears</strong><small>The map centres on the site and reveals its hourly thermal cells.</small></div>
        </article>
        <b aria-hidden="true">→</b>
        <article tabIndex={0}>
          <span>02</span><i>⚙</i><h3>Generate the day</h3><p>A saved seed creates reproducible crews, jobs, constraints and the submitted schedule.</p>
          <div><strong>What you control</strong><small>The random seed, number of crews and jobs per crew.</small></div>
        </article>
        <b aria-hidden="true">→</b>
        <article tabIndex={0}>
          <span>03</span><i>↗</i><h3>Run HeatShift</h3><p>Weather, task-hour risk and constrained scheduling produce a plan to review.</p>
          <div><strong>What to inspect</strong><small>Moved jobs, exposure, crew load, disruption and anything still exposed.</small></div>
        </article>
      </div>
      <div className="guide-reading-key"><i /><p><strong>Evidence key</strong> Built-in sites use cached FortyGuard evidence. New-site weather and all generated operations are clearly labeled.</p></div>
      <footer><p>Tip: hover or focus each step for the detail that becomes available.</p><button type="button" onClick={onClose}>Start exploring <span>→</span></button></footer>
    </section>
  </div>;
}
