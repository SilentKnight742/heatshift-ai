import type { Metrics } from "@/lib/api";

interface Props {
  metrics: Metrics;
}

export default function RiskSummary({ metrics }: Props) {
  const cards = [
    {
      label: "Exposure reduction",
      value: `${metrics.exposure_reduction_percent.toFixed(1)}%`,
      meta: "worker-minutes ≥ score 50",
      tone: "mint",
    },
    {
      label: "Peak site temperature",
      value: `${metrics.peak_temperature_c.toFixed(1)}°C`,
      meta: "FortyGuard heatmap · 3 PM",
      tone: "orange",
    },
    {
      label: "Peak apparent temp",
      value: `${metrics.peak_apparent_temperature_c.toFixed(1)}°C`,
      meta: "hourly environmental series",
      tone: "orange",
    },
    {
      label: "Peak screening risk",
      value: `${metrics.maximum_screening_score}/100`,
      meta: metrics.highest_risk_task,
      tone: "red",
    },
    {
      label: "Exposed worker-min",
      value: `${metrics.baseline_exposed_worker_minutes.toLocaleString()} → ${metrics.optimized_exposed_worker_minutes.toLocaleString()}`,
      meta: "baseline → optimized",
      tone: "mint",
    },
    {
      label: "Productive time retained",
      value: `${metrics.productivity_retained_percent.toFixed(0)}%`,
      meta: `${metrics.tasks_moved} tasks moved · none dropped`,
      tone: "blue",
    },
  ];

  return (
    <section className="summary-grid" aria-label="Analysis summary">
      {cards.map((card) => (
        <article className={`metric-card tone-${card.tone}`} key={card.label}>
          <span className="metric-label">{card.label}</span>
          <strong>{card.value}</strong>
          <small>{card.meta}</small>
        </article>
      ))}
    </section>
  );
}

