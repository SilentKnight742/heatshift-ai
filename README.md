# HeatShift AI

HeatShift turns historical heat evidence, jobs, crews, and operating constraints into a workable seven-day schedule. It is built for operations and HSE managers who need to decide what can move, what cannot move, which crew carries the most cumulative exposure, and what risk remains after a schedule change.

- Product: <https://heatshift-ai-zeta.vercel.app>
- API: <https://heatshift-ai-api.vercel.app>
- Independent test guide: [docs/third-party-evaluator-guide.md](docs/third-party-evaluator-guide.md)

## Product workflow

```text
site conditions → jobs and crews → task-hour screening → schedule alternatives → manager decision
```

The console covers every documented US state and Washington, DC. A manager selects one global historical week, moves between portfolio and site views, inspects each hour, edits jobs and crews, and compares three schedule layers:

1. **Original** — the immutable submitted schedule.
2. **HeatShift** — a deterministic, constraint-validated proposal.
3. **Working** — the manager-editable plan with undo and reset.

Managers can create sites by a map-drawn polygon, a map-positioned circle, or latitude/longitude and radius; create and edit crews and jobs; assign eligible crews; drag pending work; defer or cancel it; and inspect exact rejection reasons for invalid plans. Completed and in-progress jobs are locked from optimization.

## Three kinds of data

HeatShift never blurs these layers:

- **Real environmental evidence:** cached or newly provisioned FortyGuard heatmaps, hourly environmental parameters, satellite context, provider activity IDs, and integrity hashes.
- **Fictional operations:** site names, crews, worker counts, PPE, acclimatization, workloads, jobs, dependencies, windows, shade, and statuses used to demonstrate management decisions.
- **HeatShift-derived values:** task-hour screening scores, hourly spatial interpolation, schedules, Site Thermal Burden, Crew Exposure Load, disruption components, and downstream comparisons.

All five curated site-weeks are checked in. A visibly labeled demonstration profile exists only as a development outage path and is never labeled as provider evidence. A requested location is never silently replaced with Phoenix data.

## Decision metrics

- **Task-hour screening score:** versioned 0–100 policy using apparent temperature, workload, PPE, acclimatization, and sun/shade.
- **Site Thermal Burden:** `Σ max(0, hourly apparent temperature − 35°C) × 1 hour`.
- **Crew Exposure Load:** `Σ (screening score ÷ 100) × duration hours × worker count`.
- **Operational Disruption:** minutes shifted, crew reassignments, cross-day moves, manager deferrals, cancellations, and hard-constraint violations reported separately.
- **Outcomes:** original/proposed exposure, high-risk worker-hours avoided, percentage reduction at score 50, jobs moved, fixed jobs preserved, residual alerts, work retained, and schedule validity.

The 35°C burden baseline and score-50 threshold are disclosed product settings, not medical or regulatory limits. Every metric opens a deterministic definition, formula, inputs, source, comparison, and limitations.

## Evidence and empirical validation

The homepage retains the independent HEAT-SHIELD benchmark: 566 controlled human-exposure sessions, evaluated without fitting the HeatShift policy. The score’s Spearman rank correlation with measured one-hour physical-work-capacity loss was 0.7718; sessions at or above score 50 averaged 36.45 percentage points more measured loss than sessions below it. This is descriptive association, not proof of injury prevention, medical validity, or universal safety effectiveness. See [docs/real-data-validation.md](docs/real-data-validation.md).

The default portfolio week is July 15–21, 2024. Curated acquisition is explicit and resumable:

```bash
python3 scripts/seed_curated_portfolio.py
python3 scripts/seed_curated_portfolio.py --execute
```

`--execute` is the only mode that performs credit-consuming calls. It verifies provider usage, preserves a 200,000-credit reserve, checkpoints every activity ID, and never repeats a completed stage. CI never calls FortyGuard.

## Architecture

- Next.js UI with MapLibre GL JS and free OpenFreeMap vector tiles.
- Real state/site GeoJSON SVG fallback when WebGL or the tile service is unavailable.
- FastAPI domain API and deterministic weekly optimizer.
- Supabase anonymous authentication and RLS-isolated durable workspaces.
- Cloudflare Turnstile only for the single live site-week provisioning action.
- Groq for concise grounded explanations; deterministic explanations and briefing remain available without an LLM.

The browser obtains an anonymous Supabase session but domain reads and writes go through FastAPI. The backend forwards the user bearer token to Supabase so RLS remains authoritative. The service-role key stays server-side and is limited to provisioning/seed orchestration.

## Local setup

Python 3.11+ and Node.js 20+ are required.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env
PYTHONPATH=backend uvicorn app.main:app --reload --port 8000
```

In another terminal:

```bash
cd frontend
npm ci
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev
```

Local development defaults to a header-based workspace adapter so the product can be tested before cloud credentials exist. Hosted Vercel runtimes default to fail-closed Supabase JWT verification. Never set `HEATSHIFT_LOCAL_AUTH=true` in production.

## Production setup

Create the Supabase project with the Data API enabled, automatic table exposure
disabled, and automatic RLS enabled. Apply
[the Supabase migration](supabase/migrations/202609010001_weekly_operations.sql),
enable anonymous sign-ins, and configure:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_TURNSTILE_SITE_KEY
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
SUPABASE_JWKS_URL
TURNSTILE_SECRET_KEY
FORTYGUARD_API_KEY
GROQ_API_KEY or LLM_API_KEY
FORTYGUARD_CREDIT_RESERVE=200000
FORTYGUARD_SITE_WEEK_ESTIMATE=64240
HEATSHIFT_LOCAL_AUTH=false
```

Use Supabase's current `sb_publishable_...` value for the publishable variables and
the current `sb_secret_...` value for `SUPABASE_SECRET_KEY`. A legacy
`service_role` key remains compatible, but must never be exposed to the frontend.

Turnstile must allow localhost, preview, and production hostnames. Live provisioning fails before any provider submission if identity, Turnstile, geometry, date, quota, usage, or reserve validation fails. Supabase Free and Vercel Hobby are the intended zero-cost hackathon stack; no automatic paid overage is assumed.

## Public API

Compatibility routes `/health`, `/api/demo`, and `/api/validation/heatshield` remain. Weekly routes include:

```text
GET/PATCH /api/workspace
GET /api/states
GET /api/states/{state_code}/sites
POST/GET/PATCH/DELETE /api/sites[/site_id]
POST/GET /api/sites/{site_id}/provision[/advance]
CRUD /api/sites/{site_id}/crews
CRUD /api/sites/{site_id}/jobs
POST /api/sites/{site_id}/plans/optimize
POST /api/sites/{site_id}/plans/evaluate
PATCH /api/sites/{site_id}/plans/working
POST /api/analyses/{analysis_id}/questions
```

All weekly mutations require an anonymous bearer token. Provisioning additionally requires a single-use Turnstile token and idempotency key.

## Verification

```bash
PYTHONPATH=backend:. pytest backend/tests -q
python3 scripts/run_claim_evaluation.py
cd frontend
npm run lint
npm run test:unit
npm run test:e2e
npm run build
```

Current deterministic baseline: **102 backend tests pass with zero expected failures** and **14 focused frontend unit/component tests pass**. Frontend coverage includes weekly drawing, Markdown safety, state data, briefing presentation, and map fallback. Cross-browser journeys target Chromium, Firefox, WebKit, and mobile Chromium. See [docs/testing.md](docs/testing.md).

## Safety boundary

HeatShift provides screening-level planning support. It does not provide a live sensor reading, a building measurement, a medical diagnosis, an injury prediction, a regulatory exposure limit, or a substitute for on-site WBGT measurement, emergency procedures, and qualified safety judgment. The optimizer returns a validated feasible plan; it does not claim a mathematically global optimum.

Licensed under the MIT License.
