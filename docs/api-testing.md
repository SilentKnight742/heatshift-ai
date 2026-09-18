# API testing guide

Set `API` to the local or deployed backend. Local development may use the workspace header while `HEATSHIFT_LOCAL_AUTH=true`:

```bash
export API=http://127.0.0.1:8000
export WORKSPACE=evaluator-1
curl -sS "$API/health"
curl -sS "$API/api/daily/states"
curl -sS -H "x-heatshift-workspace: $WORKSPACE" "$API/api/daily/sites"
```

Hosted production requires an anonymous Supabase bearer token instead:

```bash
export TOKEN='anonymous-supabase-access-token'
export AUTH="Authorization: Bearer $TOKEN"
```

Replace `-H "x-heatshift-workspace: $WORKSPACE"` below with `-H "$AUTH"` for production.

## Provider status

```bash
curl -sS -H "x-heatshift-workspace: $WORKSPACE" \
  "$API/api/daily/provider-status"

curl -sS -H "x-heatshift-workspace: $WORKSPACE" \
  "$API/api/daily/provider-status?refresh=true"
```

The first call may use the five-minute cache. `refresh=true` is the Retry behavior and forces a new read-only provider request. Expected states are `available`, `provider_unavailable`, `credits_exhausted` and `not_configured`. This route must never submit a provider activity.

## Create a daily site

```bash
curl -sS -X POST "$API/api/daily/sites" \
  -H "x-heatshift-workspace: $WORKSPACE" \
  -H 'content-type: application/json' \
  -d '{
    "name":"Evaluation yard",
    "state_code":"AZ",
    "site_type":"maintenance yard",
    "operation_date":"2024-07-18",
    "geometry":{"type":"coordinates","longitude":-112.05,"latitude":33.45,"radius_m":600}
  }'
```

The response must say `site_created`, `simulated_local` and Analysis not ready in the UI. Geometry outside Arizona, above 10 mi², before 2019 or in the future must fail.

Save the returned ID:

```bash
export SITE='site-returned-by-api'
```

## Generate the operation

```bash
curl -sS -X POST "$API/api/daily/sites/$SITE/simulation" \
  -H "x-heatshift-workspace: $WORKSPACE" \
  -H 'content-type: application/json' \
  -d '{"seed":90210,"crew_count":6,"jobs_per_crew":3}'
```

The response contains 24 simulated hourly conditions, 63 cells, six crews and eighteen jobs. Repeating the same request yields the same operation.

## Run analysis

```bash
curl -sS -X POST "$API/api/daily/sites/$SITE/analysis" \
  -H "x-heatshift-workspace: $WORKSPACE"
```

Inspect `original`, `heatshift`, `metrics`, `explanations`, `recommendations`, `limitations` and `briefing_markdown`. Analysis before simulation must fail. The proposal must preserve duration, fixed jobs, eligibility, time windows and crew non-overlap.

## Reset

```bash
curl -sS -X POST "$API/api/daily/reset" \
  -H "x-heatshift-workspace: $WORKSPACE"
```

The custom site disappears and Phoenix, Houston and Miami return.

## Compatibility and evidence

`POST /api/demo`, `GET /api/validation/heatshield`, `/docs` and `/health` remain public. They preserve earlier replay/validation contracts and should not be mistaken for the active daily console API.

## Safety checks

- A different workspace must not see another custom site; hosted state is isolated by Supabase RLS.
- Repeating the GET/generate/analyze sequence through fresh backend instances must retain the same custom site and workflow stage.
- Provider retry must stay read-only.
- Client input cannot supply an official task score or proposed schedule.
- Simulated evidence must never be returned with source `FortyGuard`.
- Hosted mode must reject the local workspace header when `HEATSHIFT_LOCAL_AUTH=false`.
