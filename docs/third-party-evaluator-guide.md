# HeatShift AI — third-party evaluator handbook

This handbook assumes no knowledge of HeatShift, FortyGuard, industrial heat planning, or the codebase.

## 1. What problem does it solve?

Outdoor operations managers already have jobs, crews, access windows, dependencies and deadlines. Heat can make the original plan undesirable, but “move everything to the morning” is usually impossible: some work is fixed, crews cannot overlap, specialists are only eligible for certain jobs, and moving work has a logistical cost.

HeatShift combines historical heat evidence with those operational facts. It calculates a screening score for each job-hour, searches for a constraint-valid weekly alternative, shows the exposure/logistics trade-off, and leaves the final Working plan under manager control.

The intended users are operations managers, dispatchers, HSE/safety leads, field supervisors and planners for logistics, ports, utilities, road maintenance, construction and infrastructure work. The product is not aimed at diagnosing workers or replacing professional safety programs.

## 2. Data you are looking at

Every important screen should distinguish:

| Label | Meaning |
|---|---|
| Real FortyGuard evidence | Provider heatmaps, environmental series, satellite context and activity IDs for that exact site/week |
| Fictional operation | Demonstration site name, workers, crews, jobs, logistics, dependencies and statuses |
| HeatShift-derived | Hourly cells, building context, scores, metrics and schedules calculated from the two layers above |
| Labeled demonstration profile | Development-only outage path; never provider evidence and not used by the five checked-in curated site-weeks |

A building value is not a sensor reading. It is an estimate from nearby/intersecting provider cells and the disclosed hourly interpolation. HeatShift has no live worker wearable, indoor sensor, medical data, future forecast, injury prediction or automatic job completion.

## 3. Product scope

- All 50 documented US states plus Washington, DC.
- One global historical seven-day week, starting January 1, 2019 or later and ending no later than the last completed day.
- Default curated week: July 15–21, 2024.
- Five fictional operations backed by exact cached provider site-weeks: Phoenix, Houston, Miami, Las Vegas and New York City.
- One protected live site-week per anonymous workspace.
- State portfolio map and detailed site map with automatic SVG fallback.
- Site, crew and job CRUD; map placement; schedule editing; statuses; metrics; deterministic explanations and grounded AI Q&A.

If a selected site lacks evidence for a changed week, it must say so. Reusing another week or Phoenix evidence would be a failure.

## 4. The decision model in plain language

For every 30-minute job segment, HeatShift combines apparent heat with workload, PPE burden, acclimatization, and shade/sun. The score is a transparent 0–100 product screening score. Score 50 is a configurable comparison threshold, not a medical limit.

Three primary dimensions answer different questions:

1. **Site Thermal Burden:** how much apparent heat above 35°C accumulated across the week.
2. **Crew Exposure Load:** how much risk-weighted worker-time each crew carries.
3. **Operational Disruption:** how many minutes/jobs/crews/days the plan changes, reported as separate components.

Original is immutable. HeatShift is the deterministic proposal. Working is the manager’s editable plan. The optimizer first satisfies hard constraints, then minimizes score-50 worker-minutes, total crew load, the highest individual crew load, and finally disruption. It returns a validated feasible plan, not a mathematically proven global optimum.

## 5. First-run judge walkthrough

### Homepage

1. Confirm the hero describes a general weekly scheduling product, not one Phoenix replay.
2. Confirm the flow reads `Site conditions → jobs and crews → task-hour risk → schedule alternatives → manager decision`.
3. Confirm Site Thermal Burden, Crew Exposure Load and Operational Disruption are explained.
4. Find the HEAT-SHIELD panel: 566 sessions, 0.7718 rank correlation and 36.45 percentage-point group difference.
5. Confirm nearby text says association, not injury prevention or universal safety validity.
6. Confirm real/fictional/derived layers are explained and Phoenix appears only as an example.

### Console orientation

1. Open `/console` and follow the five-step walkthrough.
2. Confirm toolbar controls for state, week, source/quota and Walkthrough.
3. Switch AZ → TX → FL → NV → NY and confirm each portfolio changes without changing the global week.
4. Switch Portfolio/Site, pan/zoom, select a site, select seven days and scrub all 24 hours.
5. Confirm the chart, thermal field, job status board and timeline respond to the selected day/hour.
6. Confirm clock movement never automatically marks a job completed.

### Map resilience

1. Inspect a site/building/cell/job/crew. Building text must say estimate/not sensor.
2. Drag a pending job location between hotter/cooler cells; a recomputed analysis may change that task’s score. An outside drop must be rejected.
3. Drag an eligible crew card onto a job.
4. Click “Use SVG fallback.” The state/site outline, thermal cells, sites/jobs and selection must remain visible.
5. A browser without WebGL should enter this fallback automatically.

### Create and manage an operation

1. Choose a state and Create site.
2. Draw at least three polygon vertices, or position a circle and set its radius, or enter coordinates.
3. Confirm timezone and create. Geometry outside the state/US or above 10 mi² must fail.
4. Use Sites to edit name/type/timezone and delete a private site.
5. Use Crews to edit name, workers, PPE, acclimatization and workload.
6. Use Jobs to edit name, duration, workload, assigned/eligible crews, dependencies, mobility, shade and lifecycle status.
7. Completed work must lock; a dependency cycle or deletion of an in-use crew/prerequisite must fail clearly.

### Schedule decision

1. Select Original and record a job time/crew.
2. Select HeatShift and inspect proposed changes.
3. Select Working, apply one proposal, drag a job, reassign an eligible crew, undo and reset.
4. Attempt fixed/completed movement, crew overlap, ineligible reassignment or dependency inversion. The exact constraint should appear; the last valid Working plan should remain.
5. Defer an eligible job to the next day and cancel one. Cancelled work must lower retained work and exposure; HeatShift itself must never cancel a job.
6. Confirm metric comparisons preserve Original → HeatShift → Working.

### Explainability and AI

1. Open every metric. Definition, formula, inputs, source, plan comparison and limits must appear before AI.
2. Ask a contextual question about the selected metric/job/crew.
3. Confirm Markdown headings/lists/emphasis render without raw asterisks.
4. Raw HTML/script and unsafe links must never execute.
5. Official metrics/schedules must not change after Q&A. Model answers are limited; deterministic explanations remain unlimited.

### Persistence/isolation

1. With Supabase configured, refresh and confirm private CRUD/workthrough state persists.
2. Open a clean second profile. It must not see the first profile’s private records.
3. Curated environmental data may be shared; private operational edits may not.

## 6. Live provisioning test (optional and credit-consuming)

Use only with owner approval and sufficient provider credits.

1. Create one private site and choose a valid historical week.
2. Complete Turnstile and submit once.
3. Refresh/retry with the same idempotency key. Completed activity IDs must remain identical. An identical geometry/week request may reuse a complete request-hash cache, but still consumes that anonymous workspace's one-site allowance.
4. Observe seven map stages, seven environmental stages and one satellite stage.
5. Confirm partial progress survives refresh and only missing/failed stages retry.
6. After success, the identity’s remaining live allowance becomes zero.
7. A second site, invalid/replayed Turnstile, unavailable usage, or reserve breach must fail before a new activity ID.

Observed estimate: 64,240 credits/site-week. This is an estimate, not a billing contract.

## 7. Independent verification

```bash
PYTHONPATH=backend:. pytest backend/tests -q
python3 scripts/run_claim_evaluation.py
cd frontend
npm run lint
npm run test:unit
npm run test:e2e
npm run build
```

Expected deterministic baseline: 101 backend passes and zero expected failures; 14 focused frontend unit/component passes; clean type check and production build. Browser E2E is configured for Chromium, Firefox, WebKit and mobile Chromium.

The provider-verification tier is separate. A checked-in response plus an activity ID cannot prove its own origin; use authorized read-only status verification if independent provider authentication is required. All curated hashes and 75 completed activity IDs are pinned in `claim_evaluation/evidence_manifest.json`; with the six legacy replay IDs, the optional command verifies 81 completed activities. Two additional IDs are explicitly recorded as abandoned after remaining indefinitely in `Processing` and are not used as evidence inputs.

## 8. Pass/fail summary

Pass only if:

- location and week provenance are exact and visibly classified;
- all schedule layers remain separate;
- invalid edits cannot bypass constraints;
- formulas and thresholds reproduce;
- private data stays isolated;
- provider quota/reserve/idempotency fail closed;
- MapLibre and SVG paths both work;
- AI Markdown is safe and numeric claims are grounded;
- no future forecast, sensor, medical, injury-prevention, universal-threshold or global-optimum claim appears.

## 9. Known limitations

- Historical planning simulator, not a forecast.
- Ambient/modelled evidence, not on-worker or indoor measurement.
- Buildings are derived context, not sensor readings.
- Operations are fictional even when environmental evidence is real.
- Free map/LLM/hosting tiers have no production SLA.
- One anonymous live site-week is a demo protection limit.
- The risk policy needs further independent validation before operational safety use.
- HeatShift complements, never replaces, on-site WBGT, emergency procedures and qualified safety professionals.
