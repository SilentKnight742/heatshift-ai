# Methodology

HeatShift is a historical single-day planning simulator. It has no forecast or future-weather mode.

## Environmental inputs

### Built-in sites

Phoenix, Houston and Miami select one exact day from cached FortyGuard site-week files. Hourly site conditions and spatial heat cells retain their provider/activity metadata and repository integrity hash.

For a job at a specific location, HeatShift uses the nearest cell’s difference from the 15:00 cell mean as a spatial offset:

```text
task apparent temperature
  = nearest hourly site apparent temperature
  + (nearest 15:00 cell temperature − 15:00 heat-cell mean)
```

This preserves the provider’s hourly site curve and spatial pattern without claiming every cell was independently measured each hour.

### Custom-site fallback

Custom sites currently use a transparent simulated profile. Peak temperature is influenced by day-of-year, latitude, broad regional heat behavior, longitude and seed. Humid-region states receive a different humidity curve. The simulator creates:

- 24 hourly air/apparent/wet-bulb temperatures, humidity and clear-sky solar values;
- a 7×9 field of 100 m heat cells;
- simulated vegetation, pavement and building percentages.

These values are labelled `simulated`. They are not FortyGuard evidence or measured historical weather.

## Task-hour screening score

Version `heatshift-daily-screening-v1.0` is deterministic:

```text
score = apparent-temperature points
      + workload points
      + acclimatization points
      + PPE burden points
      + solar/shade points
```

Apparent temperature contributes 8 / 20 / 32 / 45 / 55 points across `≤35`, `>35–38`, `>38–41`, `>41–44`, and `>44°C`. Workload contributes 4 / 12 / 20 / 28 for light through very heavy. Acclimatization contributes 0 / 8 / 14 for acclimatized, returning and new. PPE contributes 0 / 7 / 14. Unshaded work from 10:00–15:59 adds 10; shaded work subtracts 10. The result is clamped to 0–100.

Each job is scored in 30-minute segments and duration-weighted into its schedule-entry score. Score 50 is the product’s disclosed high-risk comparison threshold—not a medical threshold, WBGT work/rest limit, regulatory limit or injury probability.

## Metrics

### Site Thermal Burden

```text
Σ max(0, hourly apparent temperature − 35°C) × 1 hour
```

Reported as apparent-temperature degree-hours for the operation day. The 35°C baseline is configurable product policy, not a medical limit.

### Crew Exposure Load

```text
Σ (task screening score ÷ 100) × task duration hours × crew size
```

Reported as risk-weighted worker-hours by plan. It is a scheduling indicator, not physiological dose.

### Operational Disruption

HeatShift does not invent a composite disruption score. It reports total shifted minutes and crew reassignments separately; hard-constraint violations must remain zero.

### Downstream outcomes

Worker-minutes at score ≥50, high-risk worker-hours avoided, percentage reduction, moved jobs, fixed jobs preserved, residual alerts, retained work and validity all follow from comparing Original with HeatShift. Percentage reduction is threshold-dependent and never means injuries prevented.

## Operation generation

The user selects a seed, 4–12 crews and 3–6 jobs per crew. The seed deterministically controls worker counts, PPE, acclimatization, workloads, job duration, assigned/eligible crews, mobility, shade and site-relative positions.

An available LLM may return twelve short activity labels based only on the site type. If unavailable or invalid, a checked-in deterministic label list is used. The LLM never creates official numbers or constraints.

## Single-day optimizer

Candidate starts are aligned to 30 minutes between each movable job’s earliest start and latest finish. For every eligible crew and start, the engine recalculates the task score and rejects crew overlap. Two bounded improvement passes use this lexicographic objective:

1. minimum worker-minutes at score ≥50;
2. minimum total Crew Exposure Load;
3. minimum highest individual crew load;
4. minimum total shifted minutes;
5. minimum crew reassignments;
6. deterministic tie-break by time, crew and job ID.

Fixed jobs keep their original entry. Durations, allowed windows, crew eligibility and non-overlap are validated after optimization. The proposal never drops a job, so productive task time remains 100% in the current daily flow.

The result is the best validated feasible plan found by bounded deterministic search, not a proof of global optimality.

## Briefing authority

The operational briefing is generated from the completed deterministic result. Markdown is rendered with GFM support and raw HTML disabled. The briefing cannot change a schedule or metric.

## Empirical boundary

The independent HEAT-SHIELD benchmark applies the policy without fitting to 566 controlled human-exposure sessions. Its association with measured work-capacity loss supports use as a screening ordering signal, not clinical validity, causality, injury reduction or universal safety effectiveness. See [real-data-validation.md](real-data-validation.md).
