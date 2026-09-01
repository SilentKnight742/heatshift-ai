# Test strategy and current baseline

## Baseline

| Layer | Current result | Scope |
|---|---:|---|
| Backend | 101 passed, 0 expected failures | Auth, ownership, CRUD, geometry, quota, provisioning, provider normalization/cache, metrics, optimizer, AI grounding, compatibility APIs and claim evaluation |
| Frontend unit/component | 14 passed | API client, briefing presentation, weekly Markdown safety, state-map drawing and forced SVG fallback |
| TypeScript | Passed | Full frontend type check |
| Production build | Passed | Next.js static homepage and console |
| Browser journeys | 12 runnable-host passes; WebKit delegated to CI | Chromium, mobile Chromium and Firefox passed locally; CI installs WebKit system dependencies on Ubuntu and runs the full matrix |

The former expected-failure adversarial test has been removed. LLM prose is now checked for unsupported numbers and contradictions; invalid prose is discarded in favor of deterministic briefing text.

## Backend coverage

- Supabase JWT verification, local-adapter production fail-closed behavior and two-owner isolation.
- RLS schema/policy expectations and bearer-token forwarding.
- All 50 states plus DC, polygon/circle/coordinate geometry, exact boundary containment, 10 mi² cap and timezone validation.
- Site, crew and job CRUD; dependency cycles; crew eligibility; completed locks; cancellation dependencies; deferred/cancelled/completed lifecycle.
- One live site-week quota, global reserve, atomic claim/release behavior and concurrent reservation safety.
- Turnstile success, action/hostname mismatch, expiry/replay and fail-before-provider behavior.
- Provisioning idempotency, request-hash reuse, checkpoint/resume, partial completion, empty cells, provider error and evidence-week mismatch.
- Seven maps, seven 24-hour environmental days, satellite normalization and hourly cell reconstruction.
- Site Thermal Burden, Crew Exposure Load, transparent disruption and score-50 outcomes.
- Multi-day fixed work, cross-day windows, overlap, dependencies, eligible crews, cancellations and deterministic runtime bounds.
- Rejection of browser-submitted end times, scores, sources and other calculated values.
- Numeric grounding rejection, deterministic fallback and Q&A ownership/rate limit.
- Five distinct portfolio operations and compatibility API behavior.

## Frontend/browser coverage

- Homepage product story, HEAT-SHIELD source and non-causal limits.
- State/site/week/day/hour navigation and seven-day visibility.
- Map-drawn polygon/circle, coordinate creation and live-provisioning states.
- Site, crew and job CRUD in the left panel and job placement/crew assignment through the map.
- Original/HeatShift/Working separation; one/all proposal apply; drag, invalid-drop message, undo and reset.
- Status changes and deferral.
- Metric formula drawer and contextual Q&A.
- GFM Markdown formatting with raw HTML disabled and unsafe links removed.
- MapLibre rendering and forced WebGL fallback.
- Walkthrough completion, dismissal and restart.
- Desktop/mobile overflow, keyboard semantics, support text ≥12px, body/form text ≥14px, AI text ≥15px and primary controls ≥44px.

## Commands

```bash
PYTHONPATH=backend:. pytest backend/tests -q
python3 scripts/run_claim_evaluation.py
python3 scripts/run_claim_evaluation.py --remote --repeat 3
cd frontend
npm run lint
npm run test:unit
npm run test:e2e
npm run build
```

CI uses recorded provider contracts and mocked asynchronous transitions. It never submits a live FortyGuard job. Live cache acquisition is a separate explicit admin command.

## Manual high-risk checks

1. Use two clean browser profiles and confirm private sites never cross workspaces.
2. Submit two provisioning advances with the same idempotency key and confirm one provider workflow.
3. Exhaust or simulate the quota/reserve and confirm failure occurs before a provider activity ID appears.
4. Force WebGL off and block OpenFreeMap; verify state boundary, cells, sites and job inspection remain usable in SVG.
5. Drag a fixed/completed job, overlap one crew, choose an ineligible crew, or violate a dependency; verify the exact constraint is shown and the Working plan remains unchanged.
6. Ask AI to assert a false number; verify official fields remain unchanged and unsupported model prose is not used.

Provider activity IDs authenticate only against the provider. Checked-in JSON and hashes prove repository integrity, not independent provider origin; use the evaluator’s optional provider-verification tier when credentials permit.
