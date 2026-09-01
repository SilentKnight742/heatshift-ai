import Link from "next/link";
import ProductHeader from "@/components/ProductHeader";

const decisionSteps = [
  { number: "01", title: "Read the heat", body: "Use 198 real FortyGuard temperature cells and 11 hourly environmental observations from the Phoenix replay.", tone: "mint" },
  { number: "02", title: "Understand the work", body: "Read each crew, task, workload, PPE burden, allowed time window, dependency, shade condition and fixed commitment.", tone: "blue" },
  { number: "03", title: "Screen every task", body: "Combine environmental conditions with the human and operational context to produce a transparent 0–100 screening score.", tone: "orange" },
  { number: "04", title: "Try only valid alternatives", body: "Search 30-minute start times, rejecting crew conflicts, broken dependencies, shortened work and moves outside permitted windows.", tone: "violet" },
  { number: "05", title: "Explain the feasible plan", body: "Prefer the valid schedule with less high-risk work time, report what moved and keep every remaining alert visible.", tone: "mint" },
];

const agentSteps = ["Observe heat", "Load the shift", "Calculate exposure", "Optimize constraints", "Retrieve guidance", "Create briefing and alerts"];

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
  ["Site supervisors", "Receive a short action list and worker-facing alerts for residual risk."],
];

export default function Home() {
  return (
    <main className="marketing-page">
      <ProductHeader />

      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <span className="marketing-kicker"><i /> For operations and safety teams</span>
          <h1>Move the work.<br /><em>Keep the shift.</em></h1>
          <p>HeatShift uses real hyperlocal heat evidence to help managers move strenuous work into safer available hours—without dropping tasks, double-booking crews, or hiding the risk that remains.</p>
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
          <div className="hero-evidence-chip"><i /> Real FortyGuard replay · Phoenix</div>
          <div className="hero-task-card hero-task-before">
            <span className="hero-card-label">Before</span>
            <strong>Heavy cargo loading</strong>
            <div className="hero-time-row"><b>1:00 PM</b><span className="risk-pill critical">100 · Critical</span></div>
            <div className="hero-heat-line"><i /><span>Hottest part of the shift</span></div>
          </div>
          <div className="hero-move-arrow"><span>Move 6½ hours earlier</span><b aria-hidden="true">↓</b></div>
          <div className="hero-task-card hero-task-after">
            <span className="hero-card-label">HeatShift plan</span>
            <strong>Heavy cargo loading</strong>
            <div className="hero-time-row"><b>6:30 AM</b><span className="risk-pill moderate">49 · Moderate</span></div>
            <div className="hero-retained-line"><i /> Same crew · same duration · no work dropped</div>
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

      <section className="worked-example" id="worked-example">
        <div className="example-heading">
          <div><span className="section-number">02</span><span className="eyebrow">One complete replay</span><h2>Two tasks move. Four stay fixed. The work is preserved.</h2></div>
          <p>This demonstration combines a <strong>real FortyGuard historical replay</strong> with a <strong>fictional logistics-yard shift</strong>. It shows what the engine proposes—not what a company actually implemented.</p>
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
        <div className="section-heading method-intro"><span className="section-number">03</span><span className="eyebrow">How the proposal is made</span><h2>HeatShift searches for a better shift, not an impossible one.</h2><p>The calculation is deterministic: the same evidence, policy and work plan produce the same result. The system tests alternatives and rejects any schedule that breaks the operation.</p></div>
        <div className="decision-flow" aria-label="Five stages of the HeatShift decision process">
          {decisionSteps.map((step) => <article className={`decision-step step-${step.tone}`} key={step.number}><span>{step.number}</span><strong>{step.title}</strong><p>{step.body}</p></article>)}
        </div>
        <div className="method-detail-grid">
          <article className="method-detail-card scoring-card"><span className="eyebrow">What affects a task score?</span><h3>Temperature is only the beginning.</h3><div className="factor-stack" aria-label="Risk score factors"><span>Apparent temperature</span><span>Workload</span><span>PPE burden</span><span>Acclimatization</span><span>Sun or shade</span></div><p>The policy adds transparent points for these factors, then limits the screening score to a 0–100 range. A task at 50 or higher contributes to the high-risk worker-minute metric.</p></article>
          <article className="method-detail-card constraint-card"><span className="eyebrow">What cannot the optimizer break?</span><h3>The work still has rules.</h3><ul><li>Fixed tasks cannot move.</li><li>Crews cannot be double-booked.</li><li>Dependencies must stay in order.</li><li>Tasks must remain inside allowed windows.</li><li>Duration, crew assignment and task count are preserved.</li></ul></article>
        </div>
        <details className="technical-details"><summary>See the advanced calculation logic <span>+</span></summary><div><p><strong>Candidate generation:</strong> movable tasks are evaluated at 30-minute starts between their earliest start and latest permitted finish.</p><p><strong>Feasibility:</strong> candidates are discarded if they overlap another task for the same crew, violate a dependency, change duration or leave the permitted shift window.</p><p><strong>Objective:</strong> the engine prioritizes lower worker time at scores of 50 or higher and applies a disruption penalty so it does not move work without a measurable reason.</p><p><strong>Reproducibility:</strong> official scores, schedules and metrics are produced by deterministic code rather than generated by a language model.</p></div></details>
      </section>

      <section className="agent-explainer" id="agent">
        <div className="agent-explainer-copy"><span className="section-number">04</span><span className="eyebrow">The AI operations agent</span><h2>The AI explains the decision. It does not invent the numbers.</h2><p>The agent calls a fixed set of tools to collect evidence, load the work plan, calculate exposure, optimize the schedule, retrieve curated guidance and prepare alerts.</p><div className="agent-authority-note"><i>✓</i><p><strong>Protected boundary:</strong> schedules, scores and official metrics come from validated deterministic tools. The model can explain them, but it cannot replace them.</p></div></div>
        <div className="agent-process-card">
          <div className="agent-process-head"><span>AI</span><div><small>Auditable tool sequence</small><strong>From evidence to action</strong></div></div>
          <ol>{agentSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong><i>✓</i></li>)}</ol>
          <div className="agent-output-grid"><article><span>Do this</span><p>Move strenuous work into the coolest valid crew window.</p></article><article><span>Why</span><p>Reduce high-risk work time while preserving the shift.</p></article><article><span>Still risky</span><p>Escalate fixed high-risk work for human controls.</p></article></div>
          <p className="agent-mode-note">A free hosted model is used when available. A deterministic fallback keeps the verified workflow available if the model provider fails.</p>
        </div>
      </section>

      <section className="research-section" id="research">
        <div className="research-question"><span className="section-number">05</span><span className="eyebrow">Measured research evidence</span><h2>Do higher HeatShift scores correspond to worse measured heat-related work loss?</h2><p>We applied the unchanged HeatShift screening policy to a public slice of the HEAT-SHIELD human-exposure dataset. The score was not trained or fitted on these records.</p></div>
        <div className="research-metric-grid" aria-label="HEAT-SHIELD dataset summary">{researchMetrics.map((metric) => <article className={`research-metric metric-${metric.tone}`} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}</div>
        <div className="research-result-grid">
          <article className="capacity-chart-card"><span className="eyebrow">Measured one-hour work-capacity loss</span><h3>Sessions with higher screening scores also showed much greater measured loss.</h3><div className="capacity-bars"><div><div><span>Score below 50</span><strong>14.37%</strong></div><i className="capacity-low" style={{ width: "28.3%" }} /></div><div><div><span>Score 50 or higher</span><strong>50.82%</strong></div><i className="capacity-high" style={{ width: "100%" }} /></div></div><div className="difference-callout"><strong>+36.45</strong><span>percentage-point difference between the two groups</span></div></article>
          <article className="correlation-card"><span className="eyebrow">Do the rankings move together?</span><div className="correlation-number"><span>Spearman ρ</span><strong>0.7718</strong></div><p>When the HeatShift score was higher, measured work-capacity loss was generally higher too. This is a strong ordering relationship in this dataset.</p><div className="correlation-dots" aria-hidden="true">{Array.from({ length: 20 }).map((_, index) => <i key={index} />)}</div></article>
        </div>
        <div className="research-boundary"><div><span>What this supports</span><p>Using the screening score to rank and prioritize hotter, more demanding work situations for operational review.</p></div><div><span>What this does not prove</span><p>Medical accuracy, causation, injury reduction, general field effectiveness, regulatory compliance or a universal threshold.</p></div><a href="https://doi.org/10.6084/m9.figshare.25722300.v1" target="_blank" rel="noreferrer">Open the public HEAT-SHIELD source dataset <span>↗</span></a></div>
      </section>

      <section className="evidence-boundaries" id="evidence">
        <div className="section-heading evidence-boundary-heading"><span className="section-number">06</span><span className="eyebrow">What is real—and what is simulated</span><h2>Two evidence layers, clearly separated.</h2><p>The environmental and research evidence is real. The company, crews, tasks and manager interactions are fictional so the product can be demonstrated without exposing an actual workforce.</p></div>
        <div className="real-fiction-grid">
          <article className="real-evidence-card"><div className="boundary-card-head"><i /> <span>Real evidence</span></div><ul><li><strong>198</strong> FortyGuard temperature cells at 100 m resolution</li><li><strong>11</strong> hourly environmental observations</li><li><strong>6</strong> saved activity IDs authenticated with FortyGuard</li><li><strong>566</strong> HEAT-SHIELD exposure records</li><li>Independent reproduction of published calculations</li></ul></article>
          <article className="fictional-evidence-card"><div className="boundary-card-head"><i /> <span>Fictional demonstration</span></div><ul><li>Company and worksite identity</li><li>Crew names and worker counts</li><li>Tasks, dependencies and shift schedule</li><li>Cooling-zone placement</li><li>Manager and worker interactions</li></ul></article>
        </div>
      </section>

      <section className="users-and-scope" id="scope">
        <div className="section-heading scope-heading"><span className="section-number">07</span><span className="eyebrow">Who this is for</span><h2>Decision support for the people who plan and supervise outdoor work.</h2></div>
        <div className="user-grid">{currentUsers.map(([title, body], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><strong>{title}</strong><p>{body}</p></article>)}</div>
        <div className="scope-status-grid"><article><span>Available now</span><h3>A working historical-replay proof of concept</h3><p>Create fictional operations, evaluate them against a pinned real Phoenix environment, compare the original and optimized shift, inspect alerts and audit the evidence.</p></article><article><span>Production direction</span><h3>Live, organization-ready operations</h3><p>Future work includes live site feeds, organization accounts, saved and shared scenarios, configurable approved policies, multi-site planning and notification integrations.</p></article></div>
        <aside className="safety-scope"><strong>Screening-level decision support</strong><p>HeatShift does not diagnose illness, prescribe medical treatment or replace on-site WBGT measurement, emergency procedures, applicable regulation or a qualified safety professional.</p></aside>
      </section>

      <section className="console-entry">
        <div className="console-entry-copy"><span className="section-number">08</span><span className="eyebrow">Try the complete workflow</span><h2>Build a shift. Run the agent. Review the decision.</h2><p>The console starts with the reference replay, but you can replace its fictional crews and tasks with your own scenario.</p><Link className="primary-link light" href="/console">Open the HeatShift console <span>↗</span></Link></div>
        <ol className="console-entry-steps"><li><span>1</span><div><strong>Choose a starting point</strong><p>Use the reference scenario or create a new fictional operation.</p></div></li><li><span>2</span><div><strong>Add the work constraints</strong><p>Describe crews, tasks, workload, PPE, timing windows and dependencies.</p></div></li><li><span>3</span><div><strong>Run and review</strong><p>See what moved, why it moved, what remained fixed and which alerts still need human action.</p></div></li></ol>
      </section>

      <footer className="marketing-footer"><span>HeatShift AI</span><p>Real environmental evidence · fictional operations · deterministic metrics · human decision required.</p></footer>
    </main>
  );
}
