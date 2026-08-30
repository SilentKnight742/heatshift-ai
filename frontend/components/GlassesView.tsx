"use client";

import { useState } from "react";
import type { WorkerAlert } from "@/lib/api";

interface Props {
  alerts: WorkerAlert[];
}

export default function GlassesView({ alerts }: Props) {
  const [status, setStatus] = useState("Awaiting worker response");
  const alert = alerts[0];

  return (
    <section className="panel glasses-panel">
      <div className="panel-header compact">
        <div>
          <span className="eyebrow">Simulated endpoint</span>
          <h2>Smart-spectacles alert</h2>
        </div>
        <span className="live-chip"><i /> HUD simulation</span>
      </div>
      <div className="glasses-shell">
        <div className="glasses-scanline" />
        <div className="hud-topline">
          <span>HEATSHIFT // CHARLIE</span>
          <span>14:02</span>
        </div>
        {alert ? (
          <>
            <div className={`hud-alert hud-${alert.severity}`}>
              <span className="hud-warning">△</span>
              <div>
                <small>SCREENING ALERT</small>
                <strong>{alert.headline}</strong>
              </div>
            </div>
            <div className="hud-task">
              <span>ACTIVE TASK</span>
              <strong>{alert.task_name}</strong>
              <p>{alert.message}</p>
            </div>
            <div className="hud-action">
              <span>NEXT ACTION</span>
              <strong>{alert.next_action}</strong>
            </div>
            <div className="hud-checks">
              <span>● Hydration check due</span>
              <span>● Supervisor action required</span>
            </div>
          </>
        ) : (
          <div className="hud-clear">No high-risk alerts in the optimized schedule.</div>
        )}
      </div>
      <div className="hud-controls">
        <button onClick={() => setStatus("Alert acknowledged")}>Acknowledge</button>
        <button onClick={() => setStatus("Assistance option selected")}>Request assistance</button>
        <button className="danger" onClick={() => setStatus("Symptoms option selected · supervisor action required")}>Report symptoms</button>
      </div>
      <p className="local-state" aria-live="polite"><span /> {status} · local demo state only—nothing is transmitted</p>
    </section>
  );
}
