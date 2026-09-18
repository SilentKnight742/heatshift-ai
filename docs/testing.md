# Test strategy and current baseline

## Baseline

| Layer | Current result | Scope |
|---|---:|---|
| Backend | 83 passed | Daily API, legacy compatibility, geometry, simulation, optimizer, metrics, provider status, authentication boundaries, FortyGuard contracts and independent claims |
| Frontend unit/component | 16 passed | API/session handling, map calculations, Markdown safety, console interactions and provider fallback/retry transition |
| TypeScript | Passed | Complete frontend type check |
| Production build | Passed | Next.js homepage and console |
| Browser journeys | 8 product journeys in their intended desktop/mobile projects | Homepage, interactive map, operation story, provider retry, custom operation, no-WebGL path, typography and mobile layout |

No expected failure remains. AI prose cannot change official metrics or schedules.

## Backend coverage

- All 50 states plus DC, coordinate/circle/polygon normalization, state containment and 10 mi² cap.
- Three curated sites reconstructed from checked-in evidence.
- Isolated custom site creation, deletion and reset.
- Historical date validation and timezone assignment.
- Reproducible location/date-aware simulated evidence.
- Seeded crew/job generation, bounds and repeatability.
- Task-hour scoring, spatial cell offset and hourly segmentation.
- Site Thermal Burden, Crew Exposure Load and separate disruption calculations.
- Single-day optimizer constraints, deterministic repetition and schedule validation.
- Provider states: live, unavailable, unconfigured and exhausted credits.
- Read-only provider status caching and forced retry.
- Local workspace adapter when cloud credentials coexist, plus hosted fail-closed behavior.
- FortyGuard normalization/contracts and compatibility endpoints.
- Independent HEAT-SHIELD calculations and evidence integrity.

## Frontend and browser coverage

- Homepage hierarchy, metric formulas, empirical result and non-causal limitations.
- State/site navigation, pan/zoom, automatic site focus and clickable heat cells.
- Fixed per-state temperature scale plus within-hour cell shading.
- Hour slider, Original/HeatShift switch and active-work indication.
- Independent draggable/minimizable Agent and Analytics panels.
- True metric-card toggle behavior and deterministic explanations.
- Markdown headings, lists and emphasis with raw HTML disabled.
- Guide, reset and full-screen site/method flows.
- Custom site → generated operation → completed analysis → reset.
- Header-only provider fallback, failed-retry persistence and successful live transition.
- No blocking provider modal.
- Leaflet/GeoJSON operation without WebGL.
- Desktop/mobile overflow, keyboard semantics, ≥14 px body/form text, ≥12 px supporting text and ≥44 px primary controls.

## Launcher checks

- `bash -n scripts/start-local.sh` validates the Unix launcher, and a clean launcher run is smoke-tested against both `/health` and `/console`.
- PowerShell’s parser validates `scripts/start-local.ps1` without running it.
- Both launchers keep Python packages in `.venv`, frontend packages in `frontend/node_modules`, load the repository `.env`, and stop both child services together.

## Commands

```bash
python3 -m pytest -q
python3 scripts/run_claim_evaluation.py
cd frontend
npm run lint
npm run test:unit
npm run test:e2e
npm run build
```

Focused provider checks:

```bash
python3 -m pytest -q backend/tests/test_daily_operations.py
cd frontend
npx playwright test e2e/product.spec.ts --project=chromium --grep "provider outage"
```

CI uses recorded provider contracts and mocked provider transitions. It never submits a live FortyGuard job.

## Manual high-risk checks

1. Remove or invalidate the provider key and confirm the header says Simulated run without covering the map.
2. Retry while unavailable and confirm fallback remains active.
3. Mock a successful retry and confirm the header becomes FortyGuard live.
4. Create sites in hot/cool states and summer/winter dates; confirm every custom source remains labelled simulated.
5. Run the same seed twice and confirm the generated operation and official result repeat.
6. Force WebGL off and confirm map/cell interaction remains intact.
7. Try outside-state and oversized sites and confirm server-side rejection.
8. Restart the backend and confirm the documented limitation: custom process-local sites disappear and curated defaults return.
