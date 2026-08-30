import type { Recommendation } from "@/lib/api";

interface Props {
  recommendations: Recommendation[];
}

export default function RecommendationPanel({ recommendations }: Props) {
  return (
    <section className="panel recommendation-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Manager action queue</span>
          <h2>Recommended controls</h2>
        </div>
        <span className="count-pill">{recommendations.length} actions</span>
      </div>
      <div className="recommendation-list">
        {recommendations.map((recommendation, index) => (
          <details open={index < 2} key={recommendation.title}>
            <summary>
              <span className={`priority-dot priority-${recommendation.priority}`} />
              <span>
                <small>{recommendation.priority} priority</small>
                <strong>{recommendation.title}</strong>
              </span>
              <span className="summary-chevron">⌄</span>
            </summary>
            <div className="recommendation-body">
              <p>{recommendation.detail}</p>
              <span className="evidence-note">Evidence · {recommendation.evidence}</span>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

