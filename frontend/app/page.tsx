import Link from "next/link";
import ProductHeader from "@/components/ProductHeader";

const decisionSteps = [
  { number: "01", title: "Read the site", body: "Load hourly conditions and the day's hyperlocal thermal field for the selected worksite.", tone: "mint" },
  { number: "02", title: "Understand the operation", body: "Read jobs, crews, locations, workload, PPE, timing windows, dependencies, shade and fixed commitments.", tone: "blue" },
  { number: "03", title: "Screen every task-hour", body: "Combine environmental and operational context in a transparent, versioned 0–100 screening policy.", tone: "orange" },
  { number: "04", title: "Test workable alternatives", body: "Try 30-minute starts and eligible crews across the week, rejecting every hard-constraint violation.", tone: "violet" },
  { number: "05", title: "Put the choice in context", body: "Compare exposure, crew load and the exact disruption required, then leave the decision with the manager.", tone: "mint" },
];

const agentSteps = ["Read week conditions", "Load jobs and crews", "Compare plan layers", "Break down metrics", "Retrieve guidance", "Explain residual alerts"];

const researchMetrics = [
  { value: "566", label: "measured exposure sessions", tone: "mint" },
  { value: "32", label: "pseudonymous participants", tone: "blue" },
  { value: "6", label: "controlled studies", tone: "violet" },
  { value: "CC BY 4.0", label: "public dataset license", tone: "orange" },
];

const currentUsers = [
  ["Operations managers", "Choose when work should happen without losing sight of delivery constraints."],
  ["Safety teams", "Identify high-risk work windows and focus controls where scheduling alone cannot solve the problem."],
  ["Shift planners", "Compare the original shift with a crew-valid, dependency-valid alternative."],
  ["Site supervisors", "Review a short action list and the jobs that remain above the screening threshold."],
];

export default function Home() {
  return (
    <main className="marketing-page">
      <ProductHeader />

      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <span className="marketing-kicker"><i /> For operations and safety teams</span>
          <h1>Plan the week.<br /><em>Respect the heat.</em></h1>
          <p>HeatShift turns historical hyperlocal heat evidence, jobs and crew constraints into workable weekly schedule alternatives—then shows the exposure reduced, the disruption required and the risk that remains.</p>
          <div className="marketing-actions">
            <a className="primary-link" href="#worked-example">See how the shift changes <span>↓</span></a>
            <Link className="text-link" href="/console">Try the console <span>↗</span></Link>
          </div>
          <div className="hero-trust-line" aria-label="Evidence boundaries">
            <span><i className="dot-real" /> Real environmental evidence</span>
            <span><i className="dot-fictional" /> Fictional work scenario</span>
            <span><i className="dot-human" /> Human decision required</span>
          </div>
        </div>
        <div className="hero-shift-visual" aria-label="Heavy cargo loading moves from a critical-risk afternoon time to a moderate-risk morning time">
          <div className="hero-evidence-chip"><i /> Site conditions → operational decision</div>
          <div className="hero-task-card hero-task-before">
            <span className="hero-card-label">Original weekly plan</span>
            <strong>Jobs meet the delivery plan</strong>
            <div className="hero-time-row"><b>But heat and crew load peak together</b><span className="risk-pill critical">Review</span></div>
            <div className="hero-heat-line"><i /><span>Hot hours · cumulative crew exposure</span></div>
          </div>
          <div className="hero-move-arrow"><span>Test only feasible changes</span><b aria-hidden="true">↓</b></div>
          <div className="hero-task-card hero-task-after">
            <span className="hero-card-label">HeatShift alternative</span>
            <strong>Move what can move</strong>
            <div className="hero-time-row"><b>Keep fixed work and dependencies intact</b><span className="risk-pill moderate">Valid</span></div>
            <div className="hero-retained-line"><i /> Manager edits the Working plan before applying it</div>
          </div>
        </div>
      </section>

      <section className="problem-section" id="what-it-does">
        <div className="section-heading plain-heading">
          <span className="section-number">01</span><span className="eyebrow">The missing decision</span>
          <h2>Knowing that a site is hot is not the same as knowing what to do.</h2>
          <p>A heatmap identifies the hazard. An operations manager still has to decide which work can move, when a crew is available, which tasks must stay in order and what cannot be rescheduled.</p>
        </div>
        <div className="question-bridge" aria-label="Difference between a heatmap and HeatShift">
          <article className="question-card heatmap-question">
            <span>What a heatmap answers</span><strong>Where is it hot?</strong>
            <div className="mini-heat-grid" aria-hidden="true">{Array.from({ length: 24 }).map((_, index) => <i key={index} />)}</div>
          </article>
          <div className="bridge-arrow" aria-hidden="true">→</div>
          <article className="question-card heatshift-question">
            <span>What HeatShift adds</span>
            <ul><li>Which task should move?</li><li>What time should it move to?</li><li>Will the same crew still be available?</li><li>Which dangerous work cannot move?</li></ul>
          </article>
        </div>
      </section>

      <section className="decision-method product-dimensions">
        <div className="section-heading method-intro"><span className="section-number">02</span><span className="eyebrow">Three questions behind every recommendation</span><h2>Less heat exposure is useful only when the plan still works.</h2><p>HeatShift keeps the environmental, human and logistical sides visible instead of hiding them inside one opaque score.</p></div>
        <div className="decision-dimensions">
          <article className="method-detail-card scoring-card"><span className="eyebrow">Environment</span><h3>Site Thermal Burden</h3><p>Apparent-temperature degree-hours above a disclosed 35°C product baseline show how intense and persistent the week is. Humidity, wet bulb, solar and land-cover context stay visible beside it.</p></article>
          <article className="method-detail-card constraint-card"><span className="eyebrow">People</span><h3>Crew Exposure Load</h3><p>Risk-weighted worker-hours accumulate task score, duration and crew size. Managers can compare the total, the highest-loaded crew and the spread between crews.</p></article>
          <article className="method-detail-card disruption-card"><span className="eyebrow">Logistics</span><h3>Operational Disruption</h3><p>Minutes shifted, crew changes, cross-day moves, deferrals and cancellations are reported separately. HeatShift never disguises them as a made-up combined score.</p></article>
        </div>
      </section>

      <section className="worked-example" id="worked-example">
        <div className="example-heading">
          <div><span className="section-number">03</span><span className="eyebrow">One earlier one-day example</span><h2>Two tasks moved. Four stayed fixed. The work was preserved.</h2></div>
          <p>Phoenix is one example, not the product. This replay combines <strong>real FortyGuard historical evidence</strong> with a <strong>fictional logistics-yard shift</strong> to make the calculation easy to inspect.</p>
        </div>
        <div className="movement-board" aria-label="Original and proposed task times">
          <div className="movement-board-head"><span>Original shift</span><span>Proposed shift</span><span>Change in peak score</span></div>
          <article>
            <div><i className="task-dot cargo" /><span>Heavy cargo loading</span><strong>1:00 PM</strong></div><b aria-hidden="true">→</b>
            <div><span>Same two-hour task</span><strong>6:30 AM</strong></div>
            <div className="score-change"><span className="score-from">100</span><b>→</b><span className="score-to">49</span><small>critical to moderate</small></div>
          </article>
          <article>
            <div><i className="task-dot asphalt" /><span>Asphalt repair</span><strong>12:00 PM</strong></div><b aria-hidden="true">→</b>
            <div><span>Same 90-minute task</span><strong>7:30 AM</strong></div>
            <div className="score-change"><span className="score-from">84</span><b>→</b><span className="score-to">31</span><small>critical to moderate</small></div>
          </article>
          <div className="fixed-work-line"><i /> Four fixed tasks remain exactly where the operation required them.</div>
        </div>
        <div className="plain-result-grid" aria-label="Reference replay results">
          <article className="result-primary"><span>Time crews spend in high-risk work</span><strong>1,230 <i>→</i> 270</strong><p>worker-minutes at score 50 or higher</p></article>
          <article><span>High-risk exposure reduced</span><strong>78.0%</strong><p>at the configured threshold of 50</p></article>
          <article><span>Scheduled work retained</span><strong>100%</strong><p>no task shortened or removed</p></article>
          <article><span>Residual alerts</span><strong>2</strong><p>fixed risk remains visible</p></article>
        </div>
        <aside className="metric-definition">
          <div><span>What is a worker-minute?</span><p>One worker spending one minute on work that scores at or above the configured high-risk threshold.</p></div>
          <div><span>What does 78% mean?</span><p>The proposed schedule contains 78% less time above that screening threshold. It does <strong>not</strong> mean 78% fewer injuries.</p></div>
        </aside>
      </section>

      <section className="decision-method" id="method">
        <div className="section-heading method-intro"><span className="section-number">04</span><span className="eyebrow">How the proposal is made</span><h2>HeatShift searches for a better week, not an impossible one.</h2><p>The calculation is deterministic: the same evidence, policy and operation produce the same result. It searches within each job's explicit window and rejects any schedule that breaks the operation.</p></div>
        <div className="decision-flow" aria-label="Five stages of the HeatShift decision process">
          {decisionSteps.map((step) => <article className={`decision-step step-${step.tone}`} key={step.number}><span>{step.number}</span><strong>{step.title}</strong><p>{step.body}</p></article>)}
        </div>
        <div className="method-detail-grid">
          <article className="method-detail-card scoring-card"><span className="eyebrow">What affects a task score?</span><h3>Temperature is only the beginning.</h3><div className="factor-stack" aria-label="Risk score factors"><span>Apparent temperature</span><span>Workload</span><span>PPE burden</span><span>Acclimatization</span><span>Sun or shade</span></div><p>The policy adds transparent points for these factors, then limits the screening score to a 0–100 range. A task at 50 or higher contributes to the high-risk worker-minute metric.</p></article>
          <article className="method-detail-card constraint-card"><span className="eyebrow">What cannot the optimizer break?</span><h3>The work still has rules.</h3><ul><li>Fixed, completed and in-progress jobs cannot move.</li><li>Crews cannot be double-booked.</li><li>Dependencies must stay in order across days.</li><li>Jobs must remain inside allowed date and time windows.</li><li>Reassignment uses eligible crews only; duration never changes.</li></ul></article>
        </div>
        <details className="technical-details"><summary>See the advanced calculation logic <span>+</span></summary><div><p><strong>Candidate generation:</strong> pending movable jobs are evaluated at 30-minute starts between their earliest start and latest permitted finish, including another day only when the job window permits it.</p><p><strong>Feasibility:</strong> candidates are discarded if they overlap a crew, violate a dependency, change duration, use an ineligible crew or leave the site, week or shift bounds.</p><p><strong>Objective:</strong> first keep every hard constraint valid; then reduce score-50 worker-minutes, total Crew Exposure Load, the highest crew load and finally logistical disruption.</p><p><strong>Reproducibility:</strong> official schedules and metrics are deterministic. The scheduler returns a validated feasible plan, not a claim of mathematical global optimality.</p></div></details>
      </section>

      <section className="agent-explainer" id="agent">
        <div className="agent-explainer-copy"><span className="section-number">05</span><span className="eyebrow">The AI operations agent</span><h2>The AI explains the decision. It does not invent the numbers.</h2><p>Open any site, job, crew or metric for its deterministic formula and inputs first. Then ask a contextual question when plain language would help.</p><div className="agent-authority-note"><i>✓</i><p><strong>Protected boundary:</strong> schedules, scores and official metrics come from validated deterministic tools. Unsupported model numbers are rejected and replaced by a grounded fallback.</p></div></div>
        <div className="agent-process-card">
          <div className="agent-process-head"><span>AI</span><div><small>Auditable tool sequence</small><strong>From evidence to action</strong></div></div>
          <ol>{agentSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong><i>✓</i></li>)}</ol>
          <div className="agent-output-grid"><article><span>Do this</span><p>Move strenuous work into the coolest valid crew window.</p></article><article><span>Why</span><p>Reduce high-risk work time while preserving the shift.</p></article><article><span>Still risky</span><p>Escalate fixed high-risk work for human controls.</p></article></div>
          <p className="agent-mode-note">A free hosted model is used when available. A deterministic fallback keeps the verified workflow available if the model provider fails.</p>
        </div>
      </section>

      <section className="research-section" id="research">
        <div className="research-question"><span className="section-number">06</span><span className="eyebrow">Measured research evidence</span><h2>Do higher HeatShift scores correspond to worse measured heat-related work loss?</h2><p>We applied the unchanged HeatShift screening policy to a public slice of the HEAT-SHIELD human-exposure dataset. The score was not trained or fitted on these records.</p></div>
        <div className="research-metric-grid" aria-label="HEAT-SHIELD dataset summary">{researchMetrics.map((metric) => <article className={`research-metric metric-${metric.tone}`} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}</div>
        <div className="research-result-grid">
          <article className="capacity-chart-card"><span className="eyebrow">Measured one-hour work-capacity loss</span><h3>Sessions with higher screening scores also showed much greater measured loss.</h3><div className="capacity-bars"><div><div><span>Score below 50</span><strong>14.37%</strong></div><i className="capacity-low" style={{ width: "28.3%" }} /></div><div><div><span>Score 50 or higher</span><strong>50.82%</strong></div><i className="capacity-high" style={{ width: "100%" }} /></div></div><div className="difference-callout"><strong>+36.45</strong><span>percentage-point difference between the two groups</span></div></article>
          <article className="correlation-card"><span className="eyebrow">Do the rankings move together?</span><div className="correlation-number"><span>Spearman ρ</span><strong>0.7718</strong></div><p>When the HeatShift score was higher, measured work-capacity loss was generally higher too. This is a strong ordering relationship in this dataset.</p><div className="correlation-dots" aria-hidden="true">{Array.from({ length: 20 }).map((_, index) => <i key={index} />)}</div></article>
        </div>
        <div className="research-boundary"><div><span>What this supports</span><p>Using the screening score to rank and prioritize hotter, more demanding work situations for operational review.</p></div><div><span>What this does not prove</span><p>Medical accuracy, causation, injury reduction, general field effectiveness, regulatory compliance or a universal threshold.</p></div><a href="https://doi.org/10.6084/m9.figshare.25722300.v1" target="_blank" rel="noreferrer">Open the public HEAT-SHIELD source dataset <span>↗</span></a></div>
      </section>

      <section className="evidence-boundaries" id="evidence">
        <div className="section-heading evidence-boundary-heading"><span className="section-number">07</span><span className="eyebrow">What is real—and what is simulated</span><h2>Three data layers, clearly separated.</h2><p>Provider evidence, fictional operations and HeatShift-derived values are labeled separately. A cached site is never reused for a different place or week.</p></div>
        <div className="real-fiction-grid">
          <article className="real-evidence-card"><div className="boundary-card-head"><i /> <span>Real provider and research evidence</span></div><ul><li>Daily 100m FortyGuard thermal cells for each cached site-week</li><li>Hourly environmental conditions for the selected date</li><li>Provider activity IDs and integrity hashes</li><li><strong>566</strong> public HEAT-SHIELD exposure sessions</li><li>Independent reproduction of published benchmark calculations</li></ul></article>
          <article className="fictional-evidence-card"><div className="boundary-card-head"><i /> <span>Fictional and derived</span></div><ul><li>Company, site purpose, jobs and crew identities are fictional</li><li>Schedules, dependencies and manager actions are simulated</li><li>Hourly cell values are disclosed HeatShift interpolations</li><li>Building values are cell intersections—not sensor readings</li><li>All recommendations remain screening-level decision support</li></ul></article>
        </div>
      </section>

      <section className="users-and-scope" id="scope">
        <div className="section-heading scope-heading"><span className="section-number">08</span><span className="eyebrow">Who this is for</span><h2>Decision support for the people who plan and supervise outdoor work.</h2></div>
        <div className="user-grid">{currentUsers.map(([title, body], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><strong>{title}</strong><p>{body}</p></article>)}</div>
        <div className="scope-status-grid"><article><span>Available now</span><h3>A seven-day, multi-site historical simulator</h3><p>Move across states, sites, days and hours; manage fictional jobs and crews; compare Original, HeatShift and Working plans; inspect every metric and use the map even when WebGL fails.</p></article><article><span>Production direction</span><h3>Organization-approved operating policy</h3><p>Next steps include named organization accounts, live operational feeds, role permissions, configurable reviewed policies, shared approvals, notifications and field-system integrations.</p></article></div>
        <aside className="safety-scope"><strong>Screening-level decision support</strong><p>HeatShift does not diagnose illness, prescribe medical treatment or replace on-site WBGT measurement, emergency procedures, applicable regulation or a qualified safety professional.</p></aside>
      </section>

      <section className="console-entry">
        <div className="console-entry-copy"><span className="section-number">09</span><span className="eyebrow">Try the complete workflow</span><h2>Choose a site. Plan the week. Make the call.</h2><p>Start with a curated operation, move through its evidence hour by hour, or create a private fictional site and operation of your own.</p><Link className="primary-link light" href="/console">Open the HeatShift console <span>↗</span></Link></div>
        <ol className="console-entry-steps"><li><span>1</span><div><strong>Choose state, site and week</strong><p>See only evidence that belongs to that place and date.</p></div></li><li><span>2</span><div><strong>Manage jobs and crews</strong><p>Set workload, PPE, eligibility, timing windows, dependencies, shade and status.</p></div></li><li><span>3</span><div><strong>Compare and edit</strong><p>Inspect the proposal, drag the Working plan and keep every residual alert visible.</p></div></li></ol>
      </section>

      <footer className="marketing-footer"><span>HeatShift AI</span><p>Real environmental evidence · fictional operations · deterministic metrics · human decision required.</p></footer>
    </main>
  );
}
