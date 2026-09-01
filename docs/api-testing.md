# API testing guide

Set `API` to the local or deployed backend and obtain an anonymous Supabase access token. Local development may instead send `x-heatshift-workspace: evaluator-1` while `HEATSHIFT_LOCAL_AUTH=true`.

```bash
export API=http://127.0.0.1:8000
export TOKEN='anonymous-supabase-access-token'
curl -sS "$API/health"
curl -sS "$API/api/states"
curl -sS -H "Authorization: Bearer $TOKEN" "$API/api/workspace"
curl -sS -H "Authorization: Bearer $TOKEN" "$API/api/states/AZ/sites"
```

## Create a site

```bash
curl -sS -X POST "$API/api/sites" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "name":"Evaluation yard",
    "state_code":"AZ",
    "site_type":"maintenance yard",
    "geometry":{"type":"circle","longitude":-112.05,"latitude":33.45,"radius_m":500},
    "timezone":"America/Phoenix"
  }'
```

Use the returned `site_id` for site, crew and job CRUD. Mutations from another bearer identity must return not found/unauthorized rather than exposing the record.

## Crew and job

```bash
curl -sS -X POST "$API/api/sites/$SITE/crews" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Evaluation crew","worker_count":4,"acclimatization_status":"returning","ppe_level":"medium","default_workload":"heavy"}'
```

Jobs require location, duration in 30-minute increments, workload, original/earliest/latest timestamps, assigned and eligible crew IDs, dependencies, mobility, shade and status. Coordinates must be inside the site. Dependency cycles and off-site locations return a validation error.

## Plan routes

```bash
curl -sS -X POST -H "Authorization: Bearer $TOKEN" "$API/api/sites/$SITE/plans/optimize"
curl -sS -X PATCH "$API/api/sites/$SITE/plans/working" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"entries":[...]}'
```

The API recomputes duration, end, source and score. A client cannot manufacture a lower score. Inspect `original`, `heatshift`, `working`, `plan_metrics`, `explanations`, `limitations`, `briefing_markdown` and `briefing_mode`.

## Live provisioning

```bash
curl -sS -X POST "$API/api/sites/$SITE/provision/advance" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"turnstile_token":"TOKEN","idempotency_key":"stable-request-key","week_start":"2024-07-15"}'
```

Call the same route in short intervals with the same key, or inspect `GET /api/sites/$SITE/provision`. A valid response exposes completed/pending stages and activity IDs. Invalid Turnstile, quota, usage or reserve must fail before submission. Never use an arbitrary repeated token: Turnstile tokens are single-use.

## Contextual Q&A

```bash
curl -sS -X POST "$API/api/analyses/$ANALYSIS/questions" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"question":"Why did this job move?","context":{"type":"job","id":"JOB_ID"}}'
```

The server resolves the selected record; client-provided fabricated facts are not authoritative. Q&A is limited to 20 model answers per owner/day.

## Compatibility and evidence

`POST /api/demo`, `GET /api/validation/heatshield`, `/docs`, and `/health` remain public. Compatibility responses describe the earlier narrow replay and should not be mistaken for the weekly domain API.
