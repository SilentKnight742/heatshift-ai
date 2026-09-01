# HeatShift AI — submission copy

This file is written material only. It does not submit a form, publish a video, or send an external message.

## Title and tracks

**HeatShift AI**

- Primary: Industrial & Enterprise
- Secondary: Agentic AI
- Secondary: Data Analysis & Correlation

## One-line pitch

> HeatShift turns historical heat evidence and real operating constraints into an auditable weekly plan—showing what to move, which crews carry the load, and what risk remains.

## Intended users

Operations managers, HSE/EHS leads, dispatchers and field supervisors at logistics yards, ports, utilities, road works, construction and infrastructure operations.

## Short description

Heat maps show where it is hot. Operations managers still have to decide what that means for a week of jobs, specialist crews, access windows and dependencies. HeatShift makes that decision visible.

The manager selects a US state, historical week and site, then moves through days and hours on an interactive map. Each fictional operation has editable crews and jobs: workers, PPE, acclimatization, workload, shade, mobility, eligibility, dependencies and status. HeatShift combines those inputs with real cached or newly provisioned FortyGuard environmental evidence.

A deterministic engine produces three transparent decision dimensions: Site Thermal Burden, Crew Exposure Load and separate Operational Disruption components. It then creates a constraint-valid seven-day proposal. Original remains immutable; HeatShift is the proposal; Working is the manager’s editable plan. Managers can apply one or all movements, drag jobs, reassign eligible crews, defer work, undo and reset. Fixed, completed and in-progress work stays locked, and invalid edits return the exact violated constraint.

MapLibre and OpenFreeMap provide the rich portfolio/site view. A GeoJSON/SVG renderer automatically preserves the thermal map and interactions without WebGL or map tiles. A Groq-hosted model writes concise grounded Markdown briefings and contextual answers, but deterministic fields remain authoritative. Unsupported model numbers or contradictory prose are discarded.

The homepage separately reports an unchanged-policy benchmark against 566 measured HEAT-SHIELD controlled human-exposure sessions. The 0.7718 rank correlation with one-hour work-capacity loss supports screening prioritization, not clinical validity, causality or injury prevention.

HeatShift is historical screening-level planning support. It is not a forecast, worker/building sensor, medical system, regulatory limit, or substitute for on-site WBGT and qualified safety judgment.

## Data disclosure

- Environmental provider evidence and activity IDs: real when labeled FortyGuard.
- Company/site names, crews, people, jobs and logistics: fictional demonstrations.
- Hourly cells, building context, scores, schedules and metrics: HeatShift-derived.
- Any development fallback is labeled demonstration data and is never presented as provider evidence.

## AI and development disclosure

Groq is the free hosted explanation provider; deterministic fallback keeps the official workflow usable without it. The LLM cannot mutate schedules or metrics. OpenAI Codex assisted product research, implementation, testing, documentation and UI iteration.

## Links

- Product: <https://heatshift-ai-zeta.vercel.app>
- API/docs: <https://heatshift-ai-api.vercel.app/docs>
- Repository: <https://github.com/SilentKnight742/heatshift-ai>
