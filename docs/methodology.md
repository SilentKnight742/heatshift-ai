# Screening methodology

HeatShift's official result is deterministic and independent of the LLM. The policy is versioned in `data/demo/policy_rules.json`; this document explains policy v1.0.0.

## Environmental evidence

FortyGuard returned a spatial heatmap at 15:00 and an 11-hour environmental series for 06:00–16:00 local Phoenix time. The environmental request requires a temperature input, so HeatShift does **not** present that input as an independently returned hourly ambient-temperature series. It uses the returned apparent-temperature array for the environmental risk component and shows the heatmap temperature separately.

`None` and `-999` are normalized to missing. A missing apparent temperature stops scoring explicitly rather than triggering imputation.

FortyGuard wet-bulb values are displayed as an environmental parameter. They are not described as measured workplace WBGT.

## Score

For each 30-minute task segment:

```text
score = apparent-temperature points
      + workload adjustment
      + PPE adjustment
      + acclimatization adjustment
      + direct-solar or shade adjustment
```

The sum is clamped to 0–100.

| Apparent temperature | Points |
|---|---:|
| ≤35°C | 8 |
| >35–38°C | 20 |
| >38–41°C | 32 |
| >41–44°C | 45 |
| >44°C | 55 |

Workload adds 0 / 8 / 18 / 25 points for light / moderate / heavy / very heavy work. PPE adds 0 / 5 / 10 points for low / medium / high burden. Acclimatization adds 0 / 6 / 12 points for acclimatized / returning / new crews. Unshaded work from 10:00–16:00 adds 6 points; a shaded task subtracts 5.

| Score | Product screening band |
|---|---|
| 0–24 | Low |
| 25–49 | Moderate |
| 50–74 | High |
| 75–100 | Critical |

These are product screening bands—not medical diagnoses, WBGT-based work/rest limits, or regulatory exposure limits.

## Empirical alignment check

Policy v1.0.0 is also applied, without fitting, to a 566-session slice of the
public HEAT-SHIELD controlled human-exposure dataset. A fixed heavy-work,
acclimatized profile is used; source coverall and solar conditions map to the
existing PPE and solar adjustments. The comparison uses measured one-hour
physical work-capacity loss as its outcome.

This produces a descriptive score-to-outcome Spearman correlation of 0.7718 and
a 36.45 percentage-point difference in mean measured loss between sessions below
and at/above score 50. Records include repeated trials by participants, so no
inferential p-value or causal claim is reported. See the complete
[empirical benchmark](real-data-validation.md).

## Exposure metric

For every task segment whose score is at least 50:

```text
exposed worker-minutes = segment minutes × crew worker count
```

This makes the principal metric understandable and reproducible. It does not imply an injury probability.

## Greedy optimizer

1. Split the allowable window into 30-minute candidate starts.
2. Rank movable tasks from highest to lowest workload.
3. Reject candidates outside the window, overlapping the crew, or violating dependencies.
4. Score valid candidates using worker-weighted screening risk plus 1.5 points per minute of schedule disruption.
5. Choose the lowest-objective valid start and validate the final schedule again.

The duration and crew stay unchanged; fixed tasks never move. Productivity retained is 100% when every task remains scheduled at full duration.

## Human control

The optimizer is a prioritization aid. Fixed high-risk work remains visible and generates an escalation recommendation. A qualified safety lead must use on-site measurement, company procedures, emergency planning, and applicable requirements to choose actual controls.
