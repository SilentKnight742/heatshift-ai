# HeatShift AI — third-party evaluator handbook

This handbook assumes no prior knowledge of HeatShift, FortyGuard, heat science or operations planning.

## 1. What HeatShift does

A heatmap can show that an outdoor site is hot. It does not tell a manager which job can move, when its crew is free, which work is fixed or whether a safer-looking schedule is operationally possible.

HeatShift connects those decisions. For one operation day it combines hourly environmental conditions with fictional jobs, crews and constraints; calculates a screening score for every task-hour; searches valid schedule alternatives; and shows both the exposure change and the logistical cost of the proposal.

The intended users are operations managers, dispatchers, HSE/EHS leads, site supervisors and planners in logistics, ports, utilities, road maintenance, construction and infrastructure work.

## 2. What is real and what is simulated

| Label | Meaning |
|---|---|
| Cached FortyGuard evidence | Real provider-shaped environmental evidence previously acquired for the exact built-in site/day, with activity IDs and repository integrity hashes |
| Fictional operation | Demonstration crews, worker counts, PPE, acclimatization, jobs, workloads, locations, mobility and time windows |
| Simulated local conditions | A transparent location/date-aware fallback used for newly created sites; not historical provider evidence |
| HeatShift-derived | Scores, thermal burden, crew load, schedule proposal and comparisons calculated by HeatShift |

The three built-in analyzed sites are DesertLine Logistics Yard in Phoenix, GulfGate Container Terminal in Houston and SunGrid Utility Response Zone in Miami. Their operational data is fictional even though their environmental evidence is cached provider data.

HeatShift has no worker wearable, indoor sensor, future forecast, medical data, injury prediction or automatic job completion.

## 3. Product scope

- All 50 US states plus Washington, DC.
- One historical operation date from January 1, 2019 through today.
- One interactive state/site map with pan, zoom, site selection and clickable 100 m heat cells.
- Three pre-analyzed demonstrations.
- Custom site creation by map point or coordinates/radius, constrained to the selected state and 10 mi².
- Seeded generation of 4–12 crews and 3–6 jobs per crew.
- Original and deterministic HeatShift schedule layers.
- Hourly conditions, active jobs, metric explanations, an operation/method view and a grounded briefing.

Hosted custom daily workspaces are persisted in an RLS-scoped Supabase snapshot. They survive Vercel instance changes and cold starts while remaining isolated to the anonymous identity. Local evaluation without Supabase uses process-local storage. Reset removes custom state and restores the three built-in sites.

## 4. Provider and fallback status

The console header always reports provider state:

- **Checking FortyGuard:** the initial read-only availability check is running.
- **FortyGuard live:** the provider answered successfully.
- **Simulated run:** the provider is unavailable, unconfigured or out of credits. The header states the reason and exposes **Retry**.

Retry forces a new read-only check. A failed retry remains in simulated mode. Only a successful response changes the header to FortyGuard live. The check never submits a heatmap or spends provider credits, and HeatShift never disables TLS verification.

Newly created sites currently use simulated local conditions in either provider state. “FortyGuard live” confirms reachability; it does not claim that a new site was provisioned from FortyGuard.

## 5. How the fallback simulation works

For a custom site, the selected date, season, latitude, broad regional temperature/humidity class, longitude and seed produce:

- 24 hourly values for air temperature, apparent temperature, wet bulb, humidity and solar irradiance;
- a 7×9 field of 100 m heat cells;
- simulated vegetation, pavement and building percentages;
- seeded fictional crews and jobs.

The simulation is reproducible for the same inputs. It is useful for demonstrating HeatShift’s planning loop but must not be described as measured weather for that location.

## 6. Decision model

Each job is evaluated in 30-minute segments. Its task-hour score combines apparent heat at its nearest cell, workload, PPE, acclimatization and shade/sun. Score 50 is a disclosed comparison threshold, not a medical limit.

Primary metrics:

1. **Site Thermal Burden:** apparent-temperature degree-hours above the configurable 35°C baseline.
2. **Crew Exposure Load:** risk-weighted worker-hours accumulated by crews.
3. **Operational Disruption:** shifted minutes and crew changes, shown separately.

Downstream results include original/proposed high-risk worker-minutes, worker-hours avoided, percentage reduction, moved tasks, fixed tasks preserved, residual alerts, work retained and hard violations.

The optimizer first minimizes high-risk worker-minutes, then total crew load, highest individual crew load and disruption. Fixed jobs, durations, crew non-overlap, eligibility and time windows are hard constraints. The result is a validated feasible improvement, not a guaranteed global optimum.

## 7. Recommended evaluation walkthrough

### Homepage

1. Confirm the hero says “The heat-aware operating plan.”
2. Confirm the product flow explains site conditions → jobs/crews → task-hour risk → alternatives → decision.
3. Find Site Thermal Burden, Crew Exposure Load and Operational Disruption.
4. Inspect the metric formulas and constraint summary.
5. Find the HEAT-SHIELD result: 566 sessions, 0.7718 rank correlation and 36.45 percentage-point group difference.
6. Confirm it is described as association, not injury prevention or medical validation.

### Built-in analyzed site

1. Open `/console` and note the provider status in the header.
2. Choose Arizona and DesertLine Logistics Yard.
3. Pan and zoom the map; change the hour and confirm cell shades and exact temperatures change while the state scale stays fixed.
4. Click a populated cell and inspect its temperature and jobs.
5. Switch Original and HeatShift; confirm active-work outlines respond to the hour.
6. Open each result card. Clicking the open card again must close it.
7. Expand/collapse and move the HeatShift Agent and HeatShift Analytics panels independently.
8. Open Operation & method and inspect crews, jobs, weather, score anatomy, metrics, optimizer constraints and before/after changes.

### Custom operation

1. Select any state and click Create site, or double-click the map.
2. Enter a site name, type, coordinates, radius and historical date.
3. Confirm an outside-state or greater-than-10-mi² geometry is rejected.
4. Confirm the new tab says Analysis not ready and the source says simulated local weather.
5. Choose seed, crew count and jobs per crew; click Generate simulation.
6. Inspect the generated crews/jobs in Operation & method.
7. Click Run HeatShift analysis.
8. Confirm a briefing, both schedules, metrics, explanations, zero hard violations and a clickable heat field appear.
9. Reset defaults and confirm the custom site disappears.

### Provider fallback

1. With provider access unavailable, confirm the header says Simulated run and gives the reason.
2. Confirm no blocking modal covers the map.
3. Confirm built-in sites and custom simulation/analysis remain usable.
4. Click Retry. If the provider is still unavailable, the header must remain Simulated run.
5. In a mocked/available environment, confirm a successful retry changes the header to FortyGuard live and removes Retry.

### Accessibility and resilience

1. Check desktop and mobile layouts.
2. Use Tab and Enter/Space on primary actions, tabs, cells and panels.
3. Confirm visible body/form text is at least 14 px, supporting text 12 px and primary targets 44 px.
4. Disable WebGL: the Leaflet/GeoJSON map and heat cells must still work.
5. Confirm Markdown renders as headings/lists/emphasis and raw HTML does not execute.

## 8. Independent verification

One-command launch:

```bash
./scripts/start-local.sh
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

Full checks:

```bash
python3 -m pytest -q
python3 scripts/run_claim_evaluation.py
cd frontend
npm run lint
npm run test:unit
npm run test:e2e
npm run build
```

Provider verification is a separate optional read-only tier. Checked-in JSON plus an activity ID proves repository traceability, not provider origin by itself.

## 9. Pass/fail checklist

Pass only if:

- cached, fictional, simulated and derived data remain visibly distinct;
- the header accurately transitions between simulated fallback and provider live states;
- provider failure never blocks the map or triggers insecure TLS behavior;
- custom site → simulation → analysis works;
- exact metric formulas and threshold limitations are accessible;
- Original and HeatShift schedules remain distinct;
- the proposed schedule has zero encoded hard-constraint violations;
- the map, heat cells, hourly slider and contextual panels work on desktop and mobile;
- no forecast, sensor, medical, injury-prevention, universal-threshold or global-optimum claim appears.

## 10. Known limitations

- Historical one-day simulator, not a forecast.
- Custom-site weather is simulated and not automatically upgraded when FortyGuard becomes available.
- Hosted custom daily workspaces depend on Supabase Free availability and quota; local no-Supabase workspaces are process-local.
- Ambient/modelled conditions are not personal or indoor measurements.
- Operations are fictional even when environmental evidence is real.
- Free map, LLM and hosting tiers provide no production SLA.
- The risk policy needs additional independent validation before operational safety use.
- HeatShift complements, never replaces, on-site WBGT, emergency procedures and qualified safety professionals.
