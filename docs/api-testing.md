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

### Real-data empirical benchmark

- `GET /api/validation/heatshield` returns a reproducible analysis of 566
  measured HEAT-SHIELD human-exposure sessions from 32 pseudonymous participants.
- Confirm `dataset.license.identifier` is `CC BY 4.0`,
  `benchmark_profile.fitted_to_dataset` is `false`, and
  `benchmark_type` is `descriptive_empirical_alignment`.
- Confirm the score-to-measured-PWC-loss Spearman correlation is `0.7718` and
  `mean_loss_difference_percentage_points` is `36.45`.
- The endpoint reads the integrity-checked bundled CSV. It makes no external API
  or LLM call and requires no secret.

```bash
curl -sS https://heatshift-ai-api.vercel.app/api/validation/heatshield
```

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

### Editable fictional scenario

- `POST /api/analyze` accepts the same site, crew, and shift structure returned
  by `GET /api/demo/scenario` plus
  `"environment_source": "phoenix_reference"`.
- A caller may change the fictional site label, surface, crews, worker counts,
  acclimatization, PPE, tasks, workloads, locations, timings, dependencies,
  shade, and movable/fixed flags.
- This proof of concept deliberately keeps the geography, time window, and
  environmental evidence tied to the pinned Phoenix replay. The request is
  processed once and is not stored by the backend.

This dependency-free example changes the fictional worksite name and crew size,
then submits a custom analysis:

```bash
python3 - <<'PY'
import json
from urllib.request import Request, urlopen

base = "https://heatshift-ai-api.vercel.app"
with urlopen(f"{base}/api/demo/scenario") as response:
    scenario = json.load(response)

scenario.pop("fictional_operation", None)
scenario["environment_source"] = "phoenix_reference"
scenario["site"]["name"] = "Evaluator fabrication yard"
scenario["crews"][0]["worker_count"] = 3

request = Request(
    f"{base}/api/analyze",
    data=json.dumps(scenario).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
with urlopen(request, timeout=150) as response:
    result = json.load(response)

print(result["site"]["name"])
print(result["metrics"])
PY
```

### Job-shaped analysis workflow

- `POST /api/analyses` with `{}` returns HTTP 201 and a completed `AnalysisJob`.
- `GET /api/analyses/{analysis_id}` retrieves that job. A valid UUID can be
  reconstructed from the deterministic replay on a fresh serverless instance,
  so correctness does not rely on shared memory.
- `POST /api/analyses/{analysis_id}/agent` re-runs the auditable agent briefing.
- `POST /api/analyses` remains the job-shaped reference-demo route and rejects
  custom fields. Use `POST /api/analyze` for editable fictional scenarios.

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
