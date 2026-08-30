# Independent claim-validation suite

This suite is designed to answer a narrower and more defensible question than
“do the existing tests pass?”:

> Can an evaluator who does not trust HeatShift's implementation independently
> reproduce the project's factual, arithmetic, scheduling, API, and agent
> assertions—and clearly identify what still needs outside evidence?

The answer for the current build is **yes for the published calculations and
public behavior, with three material caveats**:

1. Checked-in JSON cannot authenticate its own claim that it came from
   FortyGuard. The six activity results need read-only provider revalidation (or
   provider signatures) for external provenance certification.
2. Official metrics are protected from the LLM, but generated prose is not yet
   checked against those metrics. A model can return contradictory narrative
   after valid tool calls. This is recorded as an expected-failure adversarial
   test; evaluators must treat the structured result as authoritative.
3. The HEAT-SHIELD result is a descriptive comparison with repeated controlled
   trials and measured work-capacity loss. It is not a fitted model, independent
   participant-level validation set, field study, heat-illness endpoint, or
   causal safety-effect estimate.

## Why this suite is independent

The existing backend tests exercise the production classes. They are valuable,
but they cannot by themselves rule out a shared implementation mistake. The
new oracle in [`claim_evaluation/oracle.py`](../claim_evaluation/oracle.py):

- uses only Python's standard library;
- never imports `app`, `RiskEngine`, `ScheduleOptimizer`, or `AnalysisService`;
- parses the raw saved responses and product policy directly;
- independently normalizes observations, scores every 30-minute segment,
  enumerates documented candidate starts, and recomputes all metrics; and
- independently parses the 566-row HEAT-SHIELD CSV and recomputes its policy
  mapping, Pearson and tied-rank Spearman correlations, threshold groups,
  quantiles, band summaries, input ranges, and index comparisons; and
- compares only externally observable fields, not production internals.

SHA-256 pins in
[`claim_evaluation/evidence_manifest.json`](../claim_evaluation/evidence_manifest.json)
identify the exact evidence, scenario, and policy evaluated. They detect a
changed input, but are not proof of provider origin because the manifest and
payloads share the same repository trust boundary.

## Assurance layers

| Layer | What it checks | Failure meaning |
|---|---|---|
| A. Evidence structure | Completed status, UUIDs, 198 unique closed heatmap polygons, cell-derived min/max/mean/sample deviation, 11 unique hourly observations, finite apparent temperatures, same-day request chaining, and 10 pinned inputs | Cached inputs are malformed, inconsistent, duplicated, or changed |
| B. Independent calculation | Policy boundaries, peak/average scores, factor points, bands, thresholded worker-minutes, movements, disruption, productivity, and 3-replay aggregate | A published number cannot be derived from the disclosed rules |
| C. Constraint proof | Task identity, crew, workload, duration, earliest/latest windows, fixed work, dependencies, and same-crew overlap | The result improves its metric by violating the work plan |
| D. Differential/adversarial | 300 seeded random policy combinations, exact boundary values, missing data, deliberate metric/schedule tampering, agent error paths | Production and independent semantics diverge, or the evaluator fails to catch mutations |
| E. Public black box | Contract/schema, CORS allow/deny, complete results, three-call normalized determinism, jobs, cold replay, negative inputs, trace binding, residual alerts, sampled secret scanning | Deployment does not match source-level claims |
| F. External provenance | Read-only provider retrieval of all six activity IDs and deep comparison of `data.result` | Saved evidence is not authenticated by the named source |
| G. Empirical benchmark | HEAT-SHIELD DOI/license/checksums, 566 records, 32 participants, studies 1–6, fixed policy mapping, correlations, threshold groups, bands, ranges, public API equality, scope language, and deliberate mutations | A published empirical metric, assumption, provenance field, or limitation is wrong or silently changes |

## Claim-to-test matrix

| Project assertion | Primary checks | Current interpretation |
|---|---|---|
| 198 real 100 m heatmap cells per replay | `HEAT-*`, `CHAIN-*`, `PROV-EXT` | Cell count, geometry, statistics, granularity, IDs, and request chain pass. “Real FortyGuard” remains externally unverified without the provider check. |
| 11 hourly environmental observations | `ENV-*` | Passes timestamp spacing, metadata count, activity binding, and usable apparent-temperature checks on all three days. |
| Deterministic policy-driven scores | `CALC-*`, randomized differential tests | Passes independent replay and 300 randomized combinations, including every band boundary and clamping. |
| 1,230 → 270 on the main replay | `REMOTE-*-SCORE`, `REMOTE-*-METRIC` | Independently reproduced from segment scores and worker counts. |
| 3,690 → 810, or 78.0%, across three replays | `CALC-AGG` | Arithmetically legitimate for these three payloads, this fictional shift, policy v1.0.0, and threshold 50. It is not a health-outcome estimate. |
| 100% task time retained | `SCHED-*`, `REMOTE-*-SCHED` | Passes because all task IDs, crews, and durations remain and all constraints hold. It is not a general productivity study. |
| Documented greedy movements | `OPT-*`, `REMOTE-*-MOVE` | Passes independent candidate enumeration for every replay. This does not claim the greedy method is globally optimal for arbitrary future schedules. |
| LLM cannot alter official calculations | metric comparison before/after agent rerun; tool binding | Passes for structured metrics. The separate narrative-grounding expected failure prevents this from being overstated. |
| Six successful agent tools | `REMOTE-*-AGENT` plus agent failure-path tests | Passed sampled production calls in both LLM and fallback modes. Recoverable malformed model calls can add failed trace entries, so “exactly six successful traces in every possible model run” is not a proven invariant. |
| Residual risk is not hidden | `REMOTE-*-RESIDUAL` | Passes: inventory scanning and perimeter inspection remain above threshold and produce alerts. |
| No credentials in public responses | `API-SECRETS` | No high-confidence token patterns were found in sampled discovery, schema, scenario, analysis, job, error, and agent responses. This is not a formal proof over every possible error path. |
| Zero-cost/Vercel Hobby billing | none inside the application | Requires account/billing evidence from Vercel. A self-reported health field is not independent proof. |
| 566 HEAT-SHIELD sessions / 32 participants | `HSHIELD-EVID`, `API-VALIDATION-EVID` | Passes CSV parsing, studies 1–6 selection, counts, DOI, CC BY 4.0 license, source MD5, and derived SHA-256 checks. |
| Score correlation of 0.7744 Pearson / 0.7718 Spearman | `HSHIELD-CALC`, `API-VALIDATION-METRICS` | Independently reproduced using measured one-hour PWC loss. This is association across repeated sessions, not out-of-sample predictive accuracy. |
| 14.37% vs 50.82% mean PWC loss around score 50 | `HSHIELD-CALC` | Passes: 248 sessions below 50 and 318 at/above 50 differ by 36.45 percentage points. This is a descriptive split at a product-defined threshold. |
| Moderate/high/critical empirical summaries | `HSHIELD-BANDS` | All 566 records are accounted for and means, medians, quartiles, and observed score ranges reproduce. No low-band record occurs under the fixed heavy-work profile. |
| Comparative AT/Heat Index/WBGT/UTCI correlations | `HSHIELD-INDICES` | Passes. The public result transparently shows that continuous research indices correlate at least as strongly as the coarse HeatShift score. |
| No fitting, illness, or causal claim | `HSHIELD-SCOPE`, `API-VALIDATION-PROFILE`, `API-VALIDATION-SCOPE` | Passes both repository and deployed-response checks; adversarial tests fail a response that changes the fitting flag or removes limitations. |

## Running the suite

The offline audit is deterministic, makes no network calls, and is now part of
CI:

```bash
python3 scripts/run_claim_evaluation.py
python3 -m pytest backend/tests -q
```

Run the deployed black-box tier with three complete repetitions:

```bash
python3 scripts/run_claim_evaluation.py --remote --repeat 3
```

Write a machine-readable report for an evidence bundle:

```bash
python3 scripts/run_claim_evaluation.py \
  --remote \
  --repeat 3 \
  --json-out claim-report.json
```

Authenticate the cached response bodies against FortyGuard without creating
new activities or consuming heatmap-generation credits:

```bash
export FORTYGUARD_API_KEY="..."
python3 scripts/run_claim_evaluation.py --verify-provider
```

`PASS` means the stated check was independently reproduced. `FAIL` returns a
non-zero process status. `UNVERIFIED` is a deliberately visible external trust
gap and does not fail ordinary offline CI. `INFO` records important scope or
sensitivity without treating a disclosed product choice as a defect.

## Current observed result

On August 30, 2026, after adding the empirical benchmark, the suite observed:

- 50 ordinary/adversarial tests passing plus one expected failure for unchecked
  LLM narrative contradiction;
- 26 offline claim checks passing, zero failing, one external-provenance check
  unverified, and one sensitivity observation;
- 67 combined offline/public checks passing and zero failing across three
  deployed analysis repetitions;
- one live `llm_tool_calling` result and two
  `deterministic_fallback` results, all with identical deterministic
  fingerprints; and
- complete-analysis times of 5.792 s, 0.368 s, and 0.382 s in the final run.

The HEAT-SHIELD source workbook is not committed because the reproducible
derived slice is smaller and deployment-ready. The preparation script downloads
the public Figshare file, verifies its published MD5, selects studies 1–6, and
must reproduce the pinned CSV SHA-256. The independent oracle deliberately starts
from that derived CSV; therefore its metric agreement does not by itself prove
that every selected cell was transcribed from the workbook. The separate
byte-for-byte rebuild check covers that transformation boundary.

The official NIOSH references used by the project are directionally appropriate:
current guidance supports schedule/task controls, cool recovery, potable water,
buddy systems, added burden from exertion/PPE, and acclimatization for new and
returning workers. It also says to consult a safety and health professional
when heat stress is a workplace hazard. See the official
[workplace recommendations](https://www.cdc.gov/niosh/heat-stress/recommendations/index.html)
and [acclimatization guidance](https://www.cdc.gov/niosh/heat-stress/recommendations/acclimatization.html).

## Sensitivity and limits of the headline

The independent oracle recalculated the main replay at several product
thresholds:

| Screening threshold | Baseline → optimized worker-minutes | Reduction |
|---:|---:|---:|
| 40 | 1,410 → 1,050 | 25.5% |
| 45 | 1,230 → 870 | 29.3% |
| 50 | 1,230 → 270 | 78.0% |
| 55 | 1,230 → 270 | 78.0% |
| 60 | 1,140 → 180 | 84.2% |
| 70 | 1,140 → 180 | 84.2% |
| 80 | 900 → 180 | 80.0% |

This does not invalidate 78.0%; the project clearly labels 50 as a
product-defined screening threshold. It does show why the claim must always be
reported with its threshold, policy, fictional schedule, and three-day scope.
It must not be generalized to injury reduction, regulatory compliance, arbitrary
sites, or future weather.

## Recommended next hardening

For a higher assurance level:

1. Publish provider-signed responses, or store their hashes in an independently
   timestamped release/attestation outside this repository.
2. Add a deterministic validator for LLM prose, or generate all numeric and
   safety-critical sentences from structured templates while limiting the LLM
   to non-authoritative phrasing.
3. Distinguish successful required tools from recoverable failed attempts in
   the API contract; either return exactly six authoritative traces or document
   an attempts-plus-summary model.
4. Add more sites, seasons, policies, and task topologies before making any
   general effectiveness claim; report distributions and baselines rather than
   only three similarly hot replay days.
5. Archive the JSON report, commit SHA, OpenAPI schema, CI run, provider
   attestation, and deployment/billing screenshots as one evaluator evidence
   bundle.
6. Validate the score prospectively on independent field data with on-site
   measurements and operational outcomes before making any general safety
   effectiveness claim.
