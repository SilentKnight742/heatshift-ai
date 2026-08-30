# HeatShift AI — submission-ready copy

This file contains the final written material only. It is not a submitted form,
video, or external communication.

## Project title

`HeatShift AI`

## Primary and secondary tracks

- Primary: **Track 3 — Industrial & Enterprise**
- Secondary: **Track 6 — Agentic AI**
- Secondary: **Track 7 — Data Analysis & Correlation**

## One-line pitch

> HeatShift turns hyperlocal heat and crew context into constraint-safe shift plans that reduce exposure while keeping work moving.

## Who this is for

HeatShift is for HSE/EHS managers and operations planners at logistics yards,
construction sites, utilities, ports, and other outdoor worksites. It changes
the pre-shift decision from “How hot will it be?” to “Which flexible tasks
should move, what must remain fixed, and what controls are still needed?”

## Where and when

Phoenix, Arizona. The main replay covers 28 August 2026 from 06:00–16:00
America/Phoenix, using real FortyGuard outputs with a fictional logistics-yard
operation. Repeatability replays use 25, 27, and 28 August 2026. The separate
HEAT-SHIELD benchmark is not part of the Phoenix operation.

## How FortyGuard was used

HeatShift uses FortyGuard’s heatmap and environmental-parameter workflows, then
polls the activity-status endpoint. It retains source activity IDs and
timestamps and displays 198 100-metre heatmap cells plus 11 hourly observations.
Apparent temperature and supporting environmental evidence are combined with
workload, PPE, acclimatization, shade, crews, dependencies, and scheduling
constraints. The public demo replays saved outputs from completed real
activities for reliability and zero credit consumption; live mode uses the same
submit-and-poll pipeline.

## AI disclosure

A Groq-hosted Qwen model uses a Responses-compatible tool-calling workflow to
orchestrate six validated operations and write manager and worker briefings.
Official screening scores and schedule optimization remain deterministic,
versioned, testable, and available through a fallback if the model is
unavailable. OpenAI Codex was used for development assistance, product research,
documentation, testing, and frontend iteration.

## Project description — under 500 words

Extreme heat is operationally difficult because forecasts and heatmaps describe
environmental conditions but do not know what crews are doing, which workers are
acclimatized, what PPE they wear, or which tasks can feasibly move. HSE managers
still have to translate temperature into a workable shift manually.

HeatShift AI is a pre-shift decision-support product for logistics yards,
construction sites, utilities, ports, and other outdoor operations. It combines
FortyGuard environmental evidence with a planned schedule, crew characteristics,
workload, PPE burden, shade, acclimatization, dependencies, and operating
constraints. A deterministic screening policy scores each task, while a
constraint-aware optimizer searches 30-minute alternatives without changing
duration, crew assignment, fixed work, allowed windows, or dependencies.
Managers can inspect what moved, what remained fixed, and what residual risk
still requires controls.

The Phoenix demonstration uses a fictional logistics-yard operation with three
crews, 12 workers, and six tasks, paired with outputs from completed real
FortyGuard heatmap and environmental activities. HeatShift preserves provider
activity IDs and timestamps and displays 198 100-metre heatmap cells and 11
hourly observations. The public demo replays saved real provider outputs for
reliability and zero credit consumption; the backend also supports the live API
workflow.

In the main replay, HeatShift moves two flexible heavy tasks into cooler legal
windows. Worker-minutes at or above the product’s screening threshold fall from
1,230 to 270—a 78% reduction—while 100% of scheduled task time is retained.
Fixed work still produces two residual alerts, keeping unresolved risk visible
rather than implying that it disappeared.

Separately, the unchanged policy was evaluated against 566 measured
HEAT-SHIELD sessions from 32 participants. Its score has a 0.7718 Spearman rank
correlation with measured one-hour physical work-capacity loss. This supports
prioritization value but is not clinical validation, illness prediction, or
regulatory compliance.

A tool-calling model orchestrates the workflow and creates briefings, while
official scoring and optimization remain deterministic and auditable. HeatShift
turns FortyGuard temperature intelligence into an operational decision—not
another weather dashboard.

## Optional disclosure field

The Phoenix geography and FortyGuard outputs are real; the company, workers,
and schedule are fictional. The HEAT-SHIELD benchmark is separate from the
Phoenix replay. HeatShift provides screening-level decision support and does
not claim medical prediction, injury prevention, regulatory compliance, or
replacement of on-site WBGT measurement.

## Public links

- Dashboard: <https://heatshift-ai-zeta.vercel.app>
- API and Swagger: <https://heatshift-ai-api.vercel.app/docs>
- Repository: <https://github.com/SilentKnight742/heatshift-ai>
