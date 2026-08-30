"use client";

import { useState } from "react";

type Decision = "approve" | "adjust" | "original";

const DECISIONS: Array<{ value: Decision; label: string }> = [
  { value: "approve", label: "Approve HeatShift plan" },
  { value: "adjust", label: "Adjust plan" },
  { value: "original", label: "Keep original" },
];

const CONFIRMATIONS: Record<Decision, string> = {
  approve: "HeatShift plan selected for this demonstration.",
  adjust: "Plan adjustment selected for this demonstration.",
  original: "Original shift selected for this demonstration.",
};

export default function ManagerDecisionBar() {
  const [decision, setDecision] = useState<Decision | null>(null);

  return (
    <div className="decision-bar">
      <div className="decision-heading">
        <span className="decision-icon" aria-hidden="true">✓</span>
        <span>
          <small>Manager decision · simulated</small>
          <strong>Choose the plan to carry forward</strong>
        </span>
      </div>
      <div className="decision-options" role="group" aria-label="Simulated manager decision">
        {DECISIONS.map((option) => (
          <button
            className={`decision-option decision-${option.value}${decision === option.value ? " selected" : ""}`}
            type="button"
            aria-pressed={decision === option.value}
            key={option.value}
            onClick={() => setDecision(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="decision-status" aria-live="polite">
        <span aria-hidden="true" />
        {decision ? CONFIRMATIONS[decision] : "No option selected."} Local browser state only—nothing is submitted or changed operationally.
      </p>
    </div>
  );
}
