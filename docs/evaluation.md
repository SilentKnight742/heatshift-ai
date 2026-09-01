# Evaluation

> **Compatibility benchmark:** this document preserves the earlier single-day Phoenix replay because its published claim remains reproducible. It is one example, not the identity or full scope of the current multi-site weekly product. Weekly methodology and testing are documented in [methodology.md](methodology.md) and [testing.md](testing.md).

HeatShift was replayed against three completed, non-empty FortyGuard historical responses for the same Phoenix polygon. The fictional crews, six tasks, constraints, deterministic policy v1.0.0, and screening threshold (score ≥ 50) were held constant. The evaluation runs entirely from the saved real responses and requires no network access.

| Scenario | Date | Peak site °C | Peak apparent °C | Max score | Baseline worker-min | Optimized worker-min | Reduction | Tasks moved | Disruption | Productivity |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| High-heat replay | 2026-08-25 | 42.0 | 46.4 | 100 | 1,230 | 270 | 78.0% | 2 | 720 min | 100% |
| Afternoon-hotspot replay | 2026-08-27 | 41.5 | 46.1 | 100 | 1,230 | 270 | 78.0% | 2 | 660 min | 100% |
| Lower-heat replay | 2026-08-28 | 41.5 | 45.3 | 100 | 1,230 | 270 | 78.0% | 2 | 660 min | 100% |

## Headline result

> Across three real FortyGuard replays, HeatShift reduced worker-minutes at or above the configured screening threshold by **78.0%** (3,690 → 810), while retaining **100%** of scheduled task time.

The demo agent completed 6/6 validated tool calls. Each evaluation replay used 198 heatmap cells and 11 hourly environmental observations. Live capture succeeded for both the heatmap and environmental-parameter activity for every replay; the reproducible evaluation itself used the saved responses.

## Interpretation

The result measures schedule exposure under the configured product screening policy; it does not estimate injuries prevented. Improvements come from moving the two flexible heavy tasks into lower-risk valid crew windows. Fixed tasks remain fixed, so residual exposure is visible rather than optimized away.

## Limitations

- The operation, crews, and task plan are fictional; the FortyGuard responses and activity IDs are real.
- These are three historical replays for one Phoenix polygon, not a statistical safety study.
- Apparent temperature is used for the environmental component. FortyGuard values are not presented as measured on-site WBGT.
- HeatShift bands are screening bands, not medical diagnoses or regulatory exposure limits.
- A qualified safety professional and on-site WBGT measurement remain necessary for operational controls.

Raw metrics and activity IDs are stored in `data/evaluation_results.json`.

## Separate measured-outcome benchmark

The operational replay above still combines real FortyGuard evidence with a
fictional shift. To test the policy against a real outcome, HeatShift separately
applies unchanged policy v1.0.0 to 566 controlled HEAT-SHIELD human-exposure
sessions from 32 pseudonymous participants.

The fixed score has a descriptive Spearman rank correlation of 0.7718 with
measured one-hour physical work-capacity loss. Sessions below score 50 average
14.37% measured loss; sessions at or above 50 average 50.82%, a 36.45
percentage-point difference. The comparison is not fitted, causal, clinical, or
a Phoenix field study. Full provenance, index comparisons, reproduction steps,
and correct claim language are in the
[empirical benchmark](real-data-validation.md).
