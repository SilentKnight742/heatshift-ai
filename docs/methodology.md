# Methodology

HeatShift is a historical planning simulator. It has no forecast or future-weather mode.

## Environmental acquisition and reconstruction

For each site-day, HeatShift requests a 100m heatmap at 15:00 local and a full-day environmental series. The daily cell field is reconstructed hourly as:

```text
hourly cell apparent temperature
  = hourly site apparent temperature
  + (15:00 cell temperature − 15:00 heatmap mean)
```

This preserves the provider’s hourly site curve and that day’s spatial differences. Each task segment uses the derived value from the cell nearest its mapped job point, so a valid location edit can change the task score. It does not claim that every cell was independently measured or requested at every hour. Wet bulb and humidity are hourly provider arrays. The provider’s clear-sky GHI is a daily time-range summary and is labeled as a daily average rather than an hourly reading. Satellite land-cover percentages are also explanatory context; none of these values are hidden score weights.

## Task-hour screening score

Version `heatshift-screening-v2.0` is deterministic:

```text
score = apparent-temperature points
      + workload points
      + acclimatization points
      + PPE burden points
      + solar/shade points
```

Apparent temperature contributes 8 / 20 / 32 / 45 / 55 points across `≤35`, `>35–38`, `>38–41`, `>41–44`, and `>44°C`. Workload contributes 4 / 12 / 20 / 28 for light through very heavy; acclimatization contributes 0 / 8 / 14 for acclimatized, returning and new; PPE contributes 0 / 7 / 14; unshaded work from 10:00–16:00 adds 10 while shade subtracts 10. The result is clamped to 0–100.

Score 50 is the product’s disclosed high-risk screening threshold. It is not a medical threshold, WBGT work/rest limit, regulatory exposure limit, or injury probability.

## Primary metrics

### Site Thermal Burden

```text
Σ max(0, hourly apparent temperature − 35°C) × 1 hour
```

Reported in apparent-temperature degree-hours per day/week. The 35°C baseline is configurable product policy, not a medical limit.

### Crew Exposure Load

```text
Σ (task screening score ÷ 100) × task duration hours × crew worker count
```

Reported as risk-weighted worker-hours by crew and plan, including highest crew and spread. It is a scheduling indicator, not physiological dose.

### Operational Disruption

HeatShift does not invent a composite disruption score. It reports total minutes shifted, crew reassignments, cross-day moves, manager deferrals, cancellations and hard-constraint violations separately.

### Downstream outcomes

Worker-minutes at score ≥50, high-risk worker-hours avoided, percent reduction, jobs rescheduled, fixed jobs preserved, residual alerts, work retained and constraint validity follow from the task-hour schedule comparison. Percentage reduction is threshold-dependent and does not mean injuries prevented.

## Seven-day optimizer

Candidate starts are aligned to 30 minutes. The engine uses deterministic greedy placement followed by bounded local improvement with a lexicographic objective:

1. All hard constraints satisfied.
2. Minimum worker-minutes at score ≥50.
3. Minimum total Crew Exposure Load.
4. Minimum highest individual crew load.
5. Minimum shifted minutes, crew changes and cross-day moves.

Hard constraints preserve fixed, completed and in-progress work; exact duration; date/time windows; site/week and shift bounds; crew non-overlap; eligible crews; and dependency order. Cross-day moves require an explicit window. Cancelled work is excluded; deferred work remains pending later; the proposal never cancels a job. The result is the best validated feasible plan found within bounded search, not a proven global optimum.

## AI authority

Groq receives the completed deterministic result and may write four short Markdown sections: Decision, Why, Next actions, and Still exposed. Qwen 3.8 runs with reasoning effort `none` because this is a concise explanation task and the free-tier output budget must remain available for the final answer. Numeric values are allowlisted. Unsupported numbers, missing required sections, material contradictions, or out-of-range length discard the model response and select the deterministic briefing.

Contextual Q&A receives one authoritative selected site/job/crew/metric/plan context and a question up to 500 characters. It may explain facts but cannot mutate anything. Twenty model answers per anonymous user/day are permitted; deterministic inspector explanations are unlimited and Q&A history stays in browser session storage.

## Empirical boundary

The separate HEAT-SHIELD benchmark applies the policy without fitting to 566 controlled human-exposure sessions. Its association with measured work-capacity loss supports usefulness as a screening ordering signal, not clinical validity, causality, injury reduction, or universal safety effectiveness. See [real-data-validation.md](real-data-validation.md).
