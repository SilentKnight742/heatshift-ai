import Link from "next/link";
import ProductHeader from "@/components/ProductHeader";

const evidenceMetrics = [
  { value: "566", label: "measured exposure sessions", tone: "mint" },
  { value: "32", label: "research participants", tone: "blue" },
  { value: "0.7718", label: "Spearman rank correlation", tone: "violet" },
  { value: "+36.45", label: "percentage-point loss difference", tone: "orange" },
];

const scoreBands = [
  { label: "Below threshold", value: 14.37, width: 28, tone: "cool" },
  { label: "At or above threshold", value: 50.82, width: 100, tone: "warm" },
];

export default function Home() {
  return (
    <main className="marketing-page">
      <ProductHeader />
      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <span className="marketing-kicker"><i /> Industrial heat decision support</span>
          <h1>Plan the work.<br /><em>Respect the heat.</em></h1>
          <p>HeatShift turns hyperlocal temperature evidence and operational constraints into an explainable shift plan—while keeping residual risk visible.</p>
          <div className="marketing-actions">
            <Link className="primary-link" href="/console">Open the console <span>↗</span></Link>
            <a className="text-link" href="#evidence">See the measured evidence <span>↓</span></a>
          </div>
        </div>
        <div className="marketing-hero-visual" aria-label="HeatShift decision workflow">
          <div className="workflow-orbit orbit-one" /><div className="workflow-orbit orbit-two" />
          <div className="workflow-core"><span>HS</span><small>decision<br />engine</small></div>
          <div className="workflow-node node-evidence"><i />FortyGuard evidence</div>
          <div className="workflow-node node-people"><i />Crew context</div>
          <div className="workflow-node node-plan"><i />Constraint-safe plan</div>
        </div>
      </section>

      <section className="evidence-intro" id="evidence">
        <div><span className="section-number">01</span><span className="eyebrow">Empirical benchmark</span><h2>A screening signal that tracks measured heat strain.</h2></div>
        <p>We applied the unchanged HeatShift policy to the public HEAT-SHIELD human-exposure dataset. The relationship is descriptive—not a medical diagnosis, field validation, or injury-prevention claim.</p>
      </section>

      <section className="evidence-metric-grid" aria-label="HEAT-SHIELD benchmark metrics">
        {evidenceMetrics.map((metric) => <article className={`evidence-metric metric-${metric.tone}`} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}
      </section>

      <section className="evidence-story-grid">
        <article className="evidence-chart-card">
          <span className="eyebrow">Measured one-hour work-capacity loss</span>
          <h3>Higher scores aligned with materially greater measured loss.</h3>
          <div className="loss-chart">
            {scoreBands.map((band) => <div className="loss-row" key={band.label}><div><span>{band.label}</span><strong>{band.value.toFixed(2)}%</strong></div><i className={`loss-bar loss-${band.tone}`} style={{ width: `${band.width}%` }} /></div>)}
          </div>
          <p><b>+36.45 points</b> between the two groups at the configured threshold of 50.</p>
        </article>
        <article className="method-card">
          <span className="eyebrow">What the correlation means</span>
          <div className="correlation-value"><strong>ρ</strong><span>0.7718</span></div>
          <p>As HeatShift screening scores rise, measured physical work-capacity loss generally rises too. Rank correlation supports prioritization; it does not prove causation or clinical accuracy.</p>
          <a href="https://doi.org/10.6084/m9.figshare.25722300.v1" target="_blank" rel="noreferrer">Open the CC BY 4.0 source dataset ↗</a>
        </article>
      </section>

      <section className="product-method" id="method">
        <div className="method-heading"><span className="section-number">02</span><span className="eyebrow">From evidence to decision</span><h2>Environmental intelligence becomes an operational plan.</h2></div>
        <div className="method-steps">
          <article><span>1</span><strong>Bring the shift</strong><p>Add crews, tasks, workload, PPE, shade, timing windows, and dependencies.</p></article>
          <article><span>2</span><strong>Screen and optimize</strong><p>A deterministic policy scores every task and searches only legal schedule alternatives.</p></article>
          <article><span>3</span><strong>Decide with context</strong><p>Review what moved, what stayed fixed, residual alerts, evidence, and worker-facing guidance.</p></article>
        </div>
      </section>

      <section className="marketing-cta">
        <div><span className="eyebrow">Ready to explore</span><h2>Start with the reference scenario—or build your own.</h2></div>
        <Link className="primary-link light" href="/console">Launch HeatShift console <span>↗</span></Link>
      </section>
      <footer className="marketing-footer"><span>HeatShift AI</span><p>Screening-level decision support. Not a substitute for on-site WBGT measurement or a qualified safety professional.</p></footer>
    </main>
  );
}
