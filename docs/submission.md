# HeatShift AI — current project description

This file is written material only. It does not submit a form, publish a video or send an external message.

## One-line pitch

> HeatShift turns a day of heat evidence and operational constraints into an auditable lower-exposure schedule—showing what moved, what stayed fixed and what risk remains.

## Intended users

Operations managers, HSE/EHS leads, dispatchers and field supervisors at logistics yards, ports, utilities, road works, construction and infrastructure operations.

## Description

Heat maps show where it is hot. Operations managers still have to decide what that means for today’s jobs, crews, workloads, PPE, timing windows and fixed commitments. HeatShift makes that decision visible.

The console begins with an interactive state map. Three built-in demonstrations use cached FortyGuard evidence and fictional operations in Phoenix, Houston and Miami. A user can also create a site in any US state or Washington, DC, select a historical day and generate a seeded large-scale fictional operation.

HeatShift evaluates every job in 30-minute segments using apparent heat at its mapped cell, workload, PPE, acclimatization and sun/shade. A deterministic optimizer searches eligible crews and valid start times while preserving fixed work, duration, time windows and non-overlap. It reports Site Thermal Burden, Crew Exposure Load, separate disruption components and threshold-dependent before/after outcomes.

The map is the main interface: pan, zoom, select a site, scrub the hour, click exact heat cells, inspect active work and switch between Original and HeatShift schedules. A full Operation & method view visualizes generated crews/jobs, environmental evidence, formulas, optimizer constraints and job-level changes.

Provider failure never blocks the product. The console header says Simulated run and explains whether FortyGuard is unavailable, unconfigured or out of credits. Retry performs a new read-only check; only success changes the header to FortyGuard live. New-site conditions remain clearly labelled simulated in the current build.

The homepage separately reports an unchanged-policy benchmark against 566 measured HEAT-SHIELD controlled human-exposure sessions. The 0.7718 rank correlation with one-hour work-capacity loss supports screening prioritization, not clinical validity, causality or injury prevention.

HeatShift is historical screening-level planning support. It is not a forecast, worker/building sensor, medical system, regulatory limit or substitute for on-site WBGT and qualified safety judgment.

## Data disclosure

- Cached FortyGuard environmental evidence and activity IDs: real provider evidence for built-in demonstrations.
- Custom-site hourly conditions and heat field: location/date-aware simulation.
- Site names, crews, people, jobs and logistics: fictional demonstrations.
- Scores, schedules and metrics: deterministic HeatShift-derived values.
- Optional LLM use: short activity labels only; official numbers remain deterministic.

## Current limitations

- Custom-site weather is simulated even when the provider is reachable.
- Custom daily workspaces use process-local storage and can be lost on restart/cold start.
- The optimizer returns a validated feasible result, not a proven global optimum.

## Links

- Product: <https://heatshift-ai-zeta.vercel.app>
- API/docs: <https://heatshift-ai-api.vercel.app/docs>
- Repository: <https://github.com/SilentKnight742/heatshift-ai>
