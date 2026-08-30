"use client";

import { useCallback, useEffect, useState } from "react";
import { getHeatshieldValidation, type HeatshieldValidation } from "@/lib/api";

function ValidationLoading() {
  return (
    <section className="panel validation-panel validation-loading" id="validation" aria-live="polite">
      <div className="validation-loading-copy">
        <span className="eyebrow">External empirical benchmark</span>
        <h2>Loading measured HEAT-SHIELD evidence…</h2>
        <p>This evidence request is independent from the fictional Phoenix analysis.</p>
      </div>
      <div className="validation-loading-bars" aria-hidden="true"><i /><i /><i /></div>
    </section>
  );
}

export default function HeatshieldValidationPanel() {
  const [validation, setValidation] = useState<HeatshieldValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadValidation = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setValidation(await getHeatshieldValidation(signal));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "The validation evidence could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadValidation(controller.signal);
    return () => controller.abort();
  }, [loadValidation]);

  if (loading) return <ValidationLoading />;

  if (error || !validation) {
    return (
      <section className="panel validation-panel validation-error" id="validation" aria-live="polite">
        <div><span className="eyebrow">External empirical benchmark</span><h2>HEAT-SHIELD evidence unavailable</h2><p>{error}</p></div>
        <button onClick={() => void loadValidation()}>Retry evidence</button>
      </section>
    );
  }

  const { dataset, benchmark_profile: profile, metrics } = validation;
  const below = metrics.below_high_risk_threshold;
  const above = metrics.at_or_above_high_risk_threshold;

  return (
    <section className="panel validation-panel" id="validation" aria-labelledby="validation-title">
      <div className="validation-heading">
        <div>
          <span className="eyebrow">External empirical benchmark · real measured data</span>
          <h2 id="validation-title">Does the screening score track measured heat strain?</h2>
          <p>
            We replayed HeatShift&apos;s fixed screening policy across controlled HEAT-SHIELD laboratory sessions
            and compared its score with measured physical work-capacity loss.
          </p>
        </div>
        <span className="validation-dataset-badge"><i>✓</i> 2024 HEAT-SHIELD dataset</span>
      </div>

      <div className="validation-boundary" role="note">
        <span>Keep the evidence separate</span>
        <p><strong>Real laboratory measurements.</strong> Not the fictional Phoenix worksite, not FortyGuard data, and not evidence of illness or injury reduction.</p>
      </div>

      <div className="validation-metrics" aria-label="HEAT-SHIELD validation metrics">
        <article><span>Measured sessions</span><strong>{dataset.records}</strong><small>controlled exercise records</small></article>
        <article><span>Participants</span><strong>{dataset.pseudonymous_participants}</strong><small>pseudonymous individuals</small></article>
        <article><span>Spearman association</span><strong>{metrics.score_vs_measured_pwc_loss.spearman_rho.toFixed(4)}</strong><small>score vs. measured capacity loss</small></article>
        <article><span>Threshold difference</span><strong>{metrics.mean_loss_difference_percentage_points.toFixed(2)} pp</strong><small>difference in mean measured loss</small></article>
      </div>

      <div className="validation-comparison">
        <div className="comparison-copy">
          <span className="eyebrow">Measured work-capacity loss</span>
          <h3>Sessions above the fixed threshold showed substantially greater loss.</h3>
          <p>{validation.interpretation}</p>
          <div className="validation-qualifiers" aria-label="Study qualifiers">
            <span>Controlled laboratory</span><span>Repeated measures</span><span>Descriptive association</span><span>Non-clinical outcome</span>
          </div>
        </div>
        <div className="comparison-chart" aria-label="Mean measured physical work-capacity loss comparison">
          <div className="comparison-row">
            <div><span>Below score {profile.high_risk_threshold}</span><small>{below.records} sessions</small></div>
            <div className="comparison-track"><i className="comparison-below" style={{ width: `${below.mean_measured_pwc_loss_percent}%` }} /></div>
            <strong>{below.mean_measured_pwc_loss_percent.toFixed(2)}%</strong>
          </div>
          <div className="comparison-row">
            <div><span>Score {profile.high_risk_threshold} or higher</span><small>{above.records} sessions</small></div>
            <div className="comparison-track"><i className="comparison-above" style={{ width: `${above.mean_measured_pwc_loss_percent}%` }} /></div>
            <strong>{above.mean_measured_pwc_loss_percent.toFixed(2)}%</strong>
          </div>
          <div className="comparison-difference"><strong>+{metrics.mean_loss_difference_percentage_points.toFixed(2)}</strong><span>percentage points across the fixed threshold</span></div>
        </div>
      </div>

      <div className="validation-footer">
        <div className="validation-source">
          <span>Open evidence</span>
          <a href={dataset.landing_page} target="_blank" rel="noreferrer">Dataset &amp; provenance ↗</a>
          <a href={`https://doi.org/${dataset.doi}`} target="_blank" rel="noreferrer">DOI record ↗</a>
          <a href={dataset.license.url} target="_blank" rel="noreferrer">{dataset.license.identifier} license ↗</a>
        </div>
        <details className="validation-limitations">
          <summary>Read all {validation.limitations.length} limitations <span>+</span></summary>
          <ul>{validation.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </details>
      </div>
    </section>
  );
}
