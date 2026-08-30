# Public API testing guide

Production base URL: `https://heatshift-ai-api.vercel.app`

Interactive Swagger documentation is available at
[`/docs`](https://heatshift-ai-api.vercel.app/docs). The machine-readable OpenAPI
document is at [`/openapi.json`](https://heatshift-ai-api.vercel.app/openapi.json).

## Complete automated acceptance test

The smoke script uses only Python's standard library:

```bash
python3 scripts/smoke_public_api.py
```

To require a successful hosted Groq run rather than accepting the deterministic
fallback:

```bash
python3 scripts/smoke_public_api.py --require-llm
```

The full smoke test invokes the analysis several times and therefore uses Groq
free-plan quota. The official calculations remain deterministic in either agent
mode.

## Service catalog

### Discovery and documentation

- `GET /` returns the service name and links.
- `GET /docs` serves Swagger UI for interactive third-party calls.
- `GET /openapi.json` returns the complete OpenAPI 3 schema.

### Readiness and dependency state

- `GET /health` reports backend readiness, deployment profile, FortyGuard mode,
  saved-real-response availability, and whether an LLM credential is configured.
- The endpoint never calls either external provider and never exposes a key.

### Bundled scenario

- `GET /api/demo/scenario` returns the fictional Phoenix site, three crew
  profiles, and six-task shift used by the narrow vertical slice.
- No external API or LLM call is made.

### Complete analysis

- `POST /api/demo` runs the entire workflow in one request.
- It loads the saved responses from completed real FortyGuard activities,
  normalizes 198 heatmap cells and 11 hourly observations, calculates baseline
  risk, optimizes movable work, produces recommendations and worker alerts, and
  runs the six-tool agent.
- `agent.mode` is `llm_tool_calling` when Groq succeeds and
  `deterministic_fallback` when it is unavailable or rate-limited. Both modes
  use the same official deterministic calculations.

```bash
curl -sS -X POST https://heatshift-ai-api.vercel.app/api/demo
```

### Job-shaped analysis workflow

- `POST /api/analyses` with `{}` returns HTTP 201 and a completed `AnalysisJob`.
- `GET /api/analyses/{analysis_id}` retrieves that job. A valid UUID can be
  reconstructed from the deterministic replay on a fresh serverless instance,
  so correctness does not rely on shared memory.
- `POST /api/analyses/{analysis_id}/agent` re-runs the auditable agent briefing.
- Custom scenario fields are intentionally rejected with HTTP 422 because this
  release supports exactly one fully validated site and shift.

```bash
curl -sS -X POST \
  -H 'content-type: application/json' \
  -d '{}' \
  https://heatshift-ai-api.vercel.app/api/analyses
```

### Expected acceptance values

| Field | Expected value |
|---|---:|
| Heatmap features | 198 |
| Hourly observations | 11 |
| Crews / workers | 3 / 12 |
| Tasks | 6 |
| Baseline exposed worker-minutes | 1,230 |
| Optimized exposed worker-minutes | 270 |
| Exposure reduction | 78.0% |
| Productivity retained | 100.0% |
| Agent tools | 6/6 successful |

The values are screening-level decision support for a fictional operation. They
are not medical diagnoses, measured workplace WBGT, or regulatory exposure limits.
