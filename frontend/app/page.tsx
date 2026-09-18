import Link from "next/link";
import ProductHeader from "@/components/ProductHeader";

const decisionSteps = [
  { title: "Read the site", body: "Load hourly conditions and the day's hyperlocal thermal field for the selected worksite.", tone: "mint" },
  { title: "Understand the operation", body: "Read jobs, crews, locations, workload, PPE, timing windows, dependencies, shade and fixed commitments.", tone: "blue" },
  { title: "Screen every task-hour", body: "Combine environmental and operational context in a transparent, versioned 0–100 screening policy.", tone: "orange" },
  { title: "Test workable alternatives", body: "Try 30-minute starts and eligible crews across the operation day, rejecting every hard-constraint violation.", tone: "violet" },
  { title: "Put the choice in context", body: "Compare exposure, crew load and the exact disruption required, then leave the decision with the manager.", tone: "mint" },
];

const metricDefinitions = [
  { title: "Task-hour score", formula: "0–100 from apparent heat + workload + PPE + acclimatization + sun or shade", meaning: "Screens how exposed a specific job and crew are at a specific hour." },
  { title: "High-risk worker-time", formula: "Σ workers × minutes where the task-hour score is 50 or higher", meaning: "Counts how much scheduled labour sits above the disclosed comparison threshold." },
  { title: "Exposure reduction", formula: "(original high-risk worker-time − proposed) ÷ original × 100", meaning: "Shows the relative change created by the proposed schedule—not an injury-reduction claim." },
  { title: "Site Thermal Burden", formula: "Σ max(0, hourly apparent temperature − 35°C) × 1 hour", meaning: "Summarizes the day's heat intensity and persistence using a configurable planning baseline." },
  { title: "Crew Exposure Load", formula: "Σ (task score ÷ 100) × duration hours × worker count", meaning: "Compares cumulative screened load across crews before and after scheduling." },
  { title: "Operational Disruption", formula: "Minutes shifted + crew changes, reported separately", meaning: "Makes the operational price of the proposal visible instead of hiding it in one score." },
  { title: "Work retained", formula: "Proposed productive task minutes ÷ original productive task minutes × 100", meaning: "Confirms whether the proposal preserves the submitted amount of work and task durations." },
  { title: "Schedule validity and alerts", formula: "Zero hard violations; count proposed tasks still scoring 50 or higher", meaning: "Separates a workable plan from residual heat exposure that still needs human controls." },
];

const agentSteps = ["Read hourly conditions", "Load the simulated operation", "Compare both schedules", "Break down metrics", "Retrieve guidance", "Explain residual alerts"];

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
          <h1>The heat-aware<br /><em>operating plan.</em></h1>
          <p>HeatShift combines hourly weather, crew risk factors and scheduling constraints to build a lower-exposure alternative.</p>
          <div className="marketing-actions">
            <a className="primary-link" href="#method">See how HeatShift works <span>↓</span></a>
            <Link className="secondary-link" href="/console">Try the console <span>↗</span></Link>
            <a className="secondary-link" href="#research">View the research <span>↓</span></a>
          </div>
        </div>
        <div className="hero-shift-visual" aria-label="Heavy cargo loading moves from a critical-risk afternoon time to a moderate-risk morning time">
          <div className="hero-evidence-chip"><i /> Site conditions → operational decision</div>
          <div className="hero-task-card hero-task-before">
            <span className="hero-card-label">Generated daily plan</span>
            <strong>Jobs meet the delivery plan</strong>
            <div className="hero-time-row"><b>But heat and crew load peak together</b><span className="risk-pill critical">Review</span></div>
            <div className="hero-heat-line"><i /><span>Hot hours · cumulative crew exposure</span></div>
          </div>
          <div className="hero-move-arrow"><span>Test only feasible changes</span><b aria-hidden="true">↓</b></div>
          <div className="hero-task-card hero-task-after">
            <span className="hero-card-label">HeatShift alternative</span>
            <strong>Move what can move</strong>
            <div className="hero-time-row"><b>Keep fixed work and dependencies intact</b><span className="risk-pill moderate">Valid</span></div>
            <div className="hero-retained-line"><i /> Manager reviews the proposed day before applying it</div>
          </div>
        </div>
      </section>

      <section className="problem-section" id="what-it-does">
        <div className="section-heading plain-heading">
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
        <div className="section-heading method-intro"><h2>HeatShift keeps the environmental, human and logistical sides visible instead of hiding them inside one opaque score.</h2></div>
        <div className="decision-dimensions">
          <article className="method-detail-card scoring-card"><span className="eyebrow">Environment</span><h3>Site Thermal Burden</h3><p>Apparent-temperature degree-hours above a disclosed 35°C product baseline show how intense and persistent the operation day is. Humidity, wet bulb and solar context stay visible beside it.</p></article>
          <article className="method-detail-card people-card"><span className="eyebrow">People</span><h3>Crew Exposure Load</h3><p>Risk-weighted worker-hours accumulate task score, duration and crew size. Managers can compare the total, the highest-loaded crew and the spread between crews.</p></article>
          <article className="method-detail-card disruption-card"><span className="eyebrow">Logistics</span><h3>Operational Disruption</h3><p>Minutes shifted and crew changes are reported separately. Fixed work and job duration remain hard constraints, so HeatShift never disguises trade-offs as one opaque score.</p></article>
        </div>
      </section>

      <section className="decision-method" id="method">
        <div className="section-heading method-intro"><h2>HeatShift searches for a better day, not an impossible one.</h2><p>It scores the submitted day, tests feasible alternatives and returns the best validated plan it found. The same weather, policy and operation always produce the same official result.</p></div>
        <div className="decision-flow" aria-label="Five stages of the HeatShift decision process">
          {decisionSteps.map((step) => <article className={`decision-step step-${step.tone}`} key={step.title}><i aria-hidden="true" /><strong>{step.title}</strong><p>{step.body}</p></article>)}
        </div>
        <div className="metric-calculation-heading"><h3>What the metrics mean</h3><p>Every result is calculated from visible environmental and operational inputs. None of these values is chosen by the AI briefing.</p></div>
        <div className="metric-calculation-grid">
          {metricDefinitions.map((metric) => <article key={metric.title}><strong>{metric.title}</strong><code>{metric.formula}</code><p>{metric.meaning}</p></article>)}
        </div>
        <div className="method-constraint-summary"><div><strong>The optimizer cannot break the operation.</strong><p>Fixed jobs stay fixed. Durations do not change. Crews cannot overlap. Jobs stay inside their allowed windows, dependencies remain ordered and reassignments use eligible crews only.</p></div><span>Valid proposal = zero hard-constraint violations</span></div>
        <details className="technical-details"><summary>See the advanced calculation logic <span>+</span></summary><div><p><strong>Scenario generation:</strong> a saved random seed creates reproducible crews, jobs, timing windows, workloads, PPE and fixed commitments. A configured model may enrich activity names; it cannot set the official metrics.</p><p><strong>Candidate generation:</strong> movable jobs are evaluated at 30-minute starts between their earliest start and latest permitted finish on the same day.</p><p><strong>Feasibility:</strong> candidates are discarded if they overlap a crew, change duration, use an ineligible crew or leave the daily time window.</p><p><strong>Objective:</strong> first keep every hard constraint valid; then reduce score-50 worker-minutes, total Crew Exposure Load, the highest crew load and finally logistical disruption.</p><p><strong>Reproducibility:</strong> official schedules and metrics are deterministic. The scheduler returns a validated feasible plan, not a claim of mathematical global optimality.</p></div></details>
      </section>

      <section className="agent-explainer" id="agent">
        <div className="agent-explainer-copy"><h2>The AI explains the decision. It does not invent the numbers.</h2><p>Open any site, job, crew or metric for its deterministic formula and inputs first. Then ask a contextual question when plain language would help.</p><div className="agent-authority-note"><i>✓</i><p><strong>Protected boundary:</strong> schedules, scores and official metrics come from validated deterministic tools. Unsupported model numbers are rejected and replaced by a grounded fallback.</p></div></div>
        <div className="agent-process-card">
          <div className="agent-process-head"><span>AI</span><div><small>Auditable tool sequence</small><strong>From evidence to action</strong></div></div>
          <ol>{agentSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong><i>✓</i></li>)}</ol>
          <div className="agent-output-grid"><article><span>Do this</span><p>Move strenuous work into the coolest valid crew window.</p></article><article><span>Why</span><p>Reduce high-risk work time while preserving the shift.</p></article><article><span>Still risky</span><p>Escalate fixed high-risk work for human controls.</p></article></div>
          <p className="agent-mode-note">A free hosted model is used when available. A deterministic fallback keeps the verified workflow available if the model provider fails.</p>
        </div>
      </section>

      <section className="research-section" id="research">
        <div className="research-question"><h2>Do higher HeatShift scores correspond to worse measured heat-related work loss?</h2><p>We applied the unchanged HeatShift screening policy to a public slice of the HEAT-SHIELD human-exposure dataset. The score was not trained or fitted on these records.</p></div>
        <div className="research-metric-grid" aria-label="HEAT-SHIELD dataset summary">{researchMetrics.map((metric) => <article className={`research-metric metric-${metric.tone}`} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}</div>
        <div className="research-result-grid">
          <article className="capacity-chart-card"><span className="eyebrow">Measured one-hour work-capacity loss</span><h3>Sessions with higher screening scores also showed much greater measured loss.</h3><div className="capacity-bars"><div><div><span>Score below 50</span><strong>14.37%</strong></div><i className="capacity-low" style={{ width: "28.3%" }} /></div><div><div><span>Score 50 or higher</span><strong>50.82%</strong></div><i className="capacity-high" style={{ width: "100%" }} /></div></div><div className="difference-callout"><strong>+36.45</strong><span>percentage-point difference between the two groups</span></div></article>
          <article className="correlation-card"><span className="eyebrow">Do the rankings move together?</span><div className="correlation-number"><span>Spearman ρ</span><strong>0.7718</strong></div><p>When the HeatShift score was higher, measured work-capacity loss was generally higher too. This is a strong ordering relationship in this dataset.</p><div className="correlation-dots" aria-hidden="true">{Array.from({ length: 20 }).map((_, index) => <i key={index} />)}</div></article>
        </div>
        <div className="research-boundary"><div><span>What this supports</span><p>Using the screening score to rank and prioritize hotter, more demanding work situations for operational review.</p></div><div><span>What this does not prove</span><p>Medical accuracy, causation, injury reduction, general field effectiveness, regulatory compliance or a universal threshold.</p></div><a href="https://doi.org/10.6084/m9.figshare.25722300.v1" target="_blank" rel="noreferrer">Open the public HEAT-SHIELD source dataset <span>↗</span></a></div>
      </section>

      <section className="users-and-scope" id="scope">
        <div className="section-heading scope-heading"><h2>Decision support for the people who plan and supervise outdoor work.</h2></div>
        <div className="user-grid">{currentUsers.map(([title, body], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><strong>{title}</strong><p>{body}</p></article>)}</div>
        <div className="scope-status-grid"><article><span>Available now</span><h3>A one-day, site-level operations simulator</h3><p>Start from one of three analyzed examples or create a local site, generate a reproducible large operation, run HeatShift and compare the submitted and proposed schedules hour by hour.</p></article><article><span>Production direction</span><h3>Real operating inputs and approved policy</h3><p>Next steps include live environmental acquisition, real job feeds, organization accounts, reviewed configurable policies, shared approvals, notifications and field-system integrations.</p></article></div>
        <aside className="safety-scope"><strong>Screening-level decision support</strong><p>HeatShift does not diagnose illness, prescribe medical treatment or replace on-site WBGT measurement, emergency procedures, applicable regulation or a qualified safety professional.</p></aside>
      </section>

      <section className="console-entry">
        <div className="console-entry-copy"><h2>Choose a site. Generate the day. Run HeatShift.</h2><p>Start with an already analyzed example, or place a local site and generate a reproducible large-scale fictional operation of your own.</p><Link className="primary-link light" href="/console">Open the HeatShift console <span>↗</span></Link></div>
        <ol className="console-entry-steps"><li><span>1</span><div><strong>Choose or create a site</strong><p>Select the operation location and date.</p></div></li><li><span>2</span><div><strong>Generate the daily simulation</strong><p>Create fictional crews, jobs, constraints and the submitted plan from a saved seed.</p></div></li><li><span>3</span><div><strong>Run and compare</strong><p>Combine weather, metrics and scheduling optimization, then inspect every residual alert.</p></div></li></ol>
      </section>

      <footer className="marketing-footer"><span>HeatShift AI</span><p>Screening-level operational decision support for heat-aware planning.</p></footer>
    </main>
  );
}
