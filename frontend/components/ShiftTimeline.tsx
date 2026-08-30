"use client";

import { useState } from "react";
import ManagerDecisionBar from "@/components/ManagerDecisionBar";
import type { Movement, ScheduleItem } from "@/lib/api";

interface Props {
  baseline: ScheduleItem[];
  optimized: ScheduleItem[];
  movements: Movement[];
}

const SHIFT_START = 6 * 60;
const SHIFT_DURATION = 10 * 60;

function minutes(timestamp: string) {
  const [hour, minute] = timestamp.slice(11, 16).split(":").map(Number);
  return hour * 60 + minute;
}

function label(timestamp: string) {
  const [hourText, minute] = timestamp.slice(11, 16).split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function TimelineColumn({ title, subtitle, items, movements, optimized }: {
  title: string;
  subtitle: string;
  items: ScheduleItem[];
  movements: Map<string, Movement>;
  optimized: boolean;
}) {
  return (
    <div className={`timeline-column ${optimized ? "optimized" : ""}`}>
      <div className="timeline-title">
        <span>{optimized ? "02" : "01"}</span>
        <div><strong>{title}</strong><small>{subtitle}</small></div>
      </div>
      <div className="time-axis">
        {[6, 8, 10, 12, 14, 16].map((hour) => <span key={hour}>{hour > 12 ? hour - 12 : hour}{hour >= 12 ? "p" : "a"}</span>)}
      </div>
      <div className="timeline-rows">
        {items.map((item) => {
          const left = ((minutes(item.start) - SHIFT_START) / SHIFT_DURATION) * 100;
          const width = ((minutes(item.end) - minutes(item.start)) / SHIFT_DURATION) * 100;
          const moved = movements.has(item.task_id);
          return (
            <div className="timeline-row" key={item.task_id}>
              <div className="row-label">
                <strong>{item.task_name}</strong>
                <span>{item.crew_name.replace(" Crew", "")} · {item.workload.replace("_", " ")}</span>
              </div>
              <div className="timeline-track">
                <div className={`task-bar risk-${item.peak_band} ${moved ? "moved" : ""}`} style={{ left: `${left}%`, width: `${Math.max(width, 6)}%` }}>
                  <span>{label(item.start)}</span>
                  <b>{item.peak_risk}</b>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ShiftTimeline({ baseline, optimized, movements }: Props) {
  const [showMovements, setShowMovements] = useState(true);
  const movementMap = new Map(movements.map((movement) => [movement.task_id, movement]));
  const baselineExposure = baseline.reduce((total, item) => total + item.exposed_worker_minutes, 0);
  const optimizedExposure = optimized.reduce((total, item) => total + item.exposed_worker_minutes, 0);
  return (
    <section className="panel timeline-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Constraint-checked plan</span>
          <h2>Before / after shift</h2>
        </div>
        <div className="timeline-key">
          <span><i className="key-low" /> Low</span>
          <span><i className="key-moderate" /> Moderate</span>
          <span><i className="key-high" /> High</span>
          <span><i className="key-critical" /> Critical</span>
        </div>
      </div>
      <div className="timeline-layout">
        <TimelineColumn title="Original shift" subtitle={`${baselineExposure.toLocaleString()} exposed worker-minutes`} items={baseline} movements={movementMap} optimized={false} />
        <div className="timeline-divider"><span>→</span></div>
        <TimelineColumn title="HeatShift plan" subtitle={`${optimizedExposure.toLocaleString()} exposed worker-minutes`} items={optimized} movements={movementMap} optimized />
      </div>
      <ManagerDecisionBar />
      <button className="movement-toggle" onClick={() => setShowMovements((value) => !value)}>
        <span>{showMovements ? "−" : "+"}</span> {movements.length} schedule movements · 100% task time retained
      </button>
      {showMovements && (
        <div className="movement-list">
          {movements.map((movement) => (
            <article key={movement.task_id}>
              <span className="movement-arrow">↗</span>
              <div>
                <strong>{movement.task_name}: {label(movement.from_start)} → {label(movement.to_start)}</strong>
                <p>{movement.reason}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
