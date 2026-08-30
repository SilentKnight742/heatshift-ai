import type { AnalysisResult } from "@/lib/api";

interface Props {
  analysis: AnalysisResult;
}

export default function DecisionSummary({ analysis }: Props) {
  const tasksMoved = analysis.movements.length;
  const fixedTasks = analysis.tasks.filter((task) => !task.movable).length;
  const residualAlerts = analysis.worker_alerts.length;
  const taskTimeRetained = analysis.metrics.productivity_retained_percent;

  const summary = `${tasksMoved} movable tasks rescheduled · ${fixedTasks} fixed tasks preserved · ${residualAlerts} residual alerts · ${taskTimeRetained.toFixed(0)}% task time retained`;

  return (
    <section className="panel decision-summary" aria-label={`Decision summary: ${summary}`}>
      <div className="decision-summary-copy">
        <span className="eyebrow">Operational result · manager review required</span>
        <h2>The shift changes. The work stays intact.</h2>
        <p>
          Real FortyGuard environmental evidence is combined with fictional crews and tasks.
          The result measures schedule exposure at score 50 or higher—not injuries prevented.
        </p>
      </div>
      <div className="decision-summary-grid">
        <article><strong>{tasksMoved}</strong><span>movable tasks<br />rescheduled</span></article>
        <article><strong>{fixedTasks}</strong><span>fixed tasks<br />preserved</span></article>
        <article><strong>{residualAlerts}</strong><span>residual alerts<br />still visible</span></article>
        <article><strong>{taskTimeRetained.toFixed(0)}%</strong><span>task time<br />retained</span></article>
      </div>
      <p className="decision-summary-line"><i /> {summary}</p>
    </section>
  );
}
