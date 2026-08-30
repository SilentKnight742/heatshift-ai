# Product quality and regression testing

This document describes the automated functional, contract, accessibility, and
regression test suite.

## Current local baseline

Recorded on August 31, 2026:

| Layer | Result | What it covers |
|---|---:|---|
| Backend/API | 67 passed, 1 expected failure | Models, validation, provider normalization, risk policy, optimizer constraints, API contracts, deployment behavior, agent failure paths, claim evaluation, and empirical validation |
| Frontend unit/component | 32 passed | Scenario validation and creation, JSON import/export, corrupt-storage recovery, API client contracts, local persistence workflow, result cards, SVG map, agent briefing, evidence drawer, local manager/HUD state, create/edit/add/reset behavior |
| Browser E2E | 9 passed, 1 intentional project skip | Homepage, reference console, editable analysis, browser-local create/add/reset flow, universal SVG map, agent briefing, desktop Chromium, mobile Chromium, and mobile overflow |
| Type/build | passed | Strict TypeScript and production Next.js build |

The backend expected failure is deliberate. It proves that an unconstrained
future LLM could write prose that contradicts the protected structured metrics.
The official scores, schedules, recommendations, and alerts remain
deterministic; the card explicitly tells users that the AI explanation is not
the authoritative calculation.

The browser suite defines five product flows across desktop and mobile
Chromium. The page-overflow assertion is mobile-only, so its desktop copy is
reported as one intentional skip rather than a missing test.

## Scenario matrix

The original reference replay remains pinned at 1,230 → 270 exposed
worker-minutes, 78.0% reduction, two moved tasks, and 100% task time retained.
Additional backend scenarios exercise behavior that the reference alone cannot:

1. **All work fixed:** no task may move, reduction is 0%, and residual alerts
   remain visible.
2. **Dense same-crew work:** three movable heavy tasks compete for cooler
   legal slots around a fixed task; the final plan must remain overlap-free.
3. **Dependency chain:** prepare → execute → inspect must remain ordered after
   optimization.
4. **Critical constrained work:** 100 new workers with high-PPE burden perform
   fixed very-heavy afternoon work; the score clamps to 100, all 6,000 exposed
   worker-minutes remain, and a critical alert and escalation are required.
5. **Repeated custom request:** official schedules and metrics must be identical
   while analysis IDs differ and the stateless endpoint stores neither result.
6. **Invalid matrix:** unsupported footprint/timezone/window, out-of-footprint
   coordinates, unknown crews/dependencies, extra fields, duplicate IDs,
   dependency cycles, overlaps, and collection bounds must return HTTP 422.

Every successful scenario is checked for task identity and duration retention,
fixed-task immobility, dependency ordering, same-crew non-overlap, non-increased
threshold exposure, and 100% retained task time.

## Run locally

From the repository root:

```bash
python3 -m pytest backend/tests -q
python3 scripts/run_claim_evaluation.py
```

From `frontend/`:

```bash
npm ci
npm run lint
npm run test:unit
npm run test:e2e
npm run build
```

The E2E command starts a local FastAPI server and Next.js development server.
It uses an installed `/usr/bin/chromium` when available. In CI, Playwright
installs its pinned Chromium runtime.

## Test ownership by file

| File | Responsibility |
|---|---|
| `backend/tests/test_scenario_matrix.py` | Difficult valid scenarios, invalid payload matrix, determinism, statelessness, and universal schedule invariants |
| `frontend/tests/scenario.test.ts` | Pure browser-side scenario creation, time handling, cloning, and validation |
| `frontend/tests/components.test.tsx` | Result meaning, SVG renderer, evidence UI, agent card, and local simulated controls |
| `frontend/tests/console-workspace.test.tsx` | Reference load and browser-local create/read/edit/add/reset/analyze behavior with API mocks |
| `frontend/e2e/product.spec.ts` | Real local backend + real Next.js browser journeys on desktop and mobile |
| `claim_evaluation/` | Independent arithmetic, scheduling, evidence, mutation, and public black-box oracle |

## Browser-local CRUD boundary

“CRUD” in this proof of concept does not mean a multi-user database-backed REST
collection. It means the current scenario can be created from a minimal
template, read on load, updated through the editor, removed by resetting to the
reference, and exchanged with JSON import/export. The latest edited scenario
is stored only in that browser. `POST /api/analyze` processes a validated copy
once and does not retain it.

## CI policy

GitHub Actions runs backend tests and the independent audit, frontend unit and
component tests, strict TypeScript, a production build, and the real local
browser suite on every push and pull request. Live FortyGuard activity creation
is excluded because it consumes provider credits; normal tests use pinned,
labelled real responses.
