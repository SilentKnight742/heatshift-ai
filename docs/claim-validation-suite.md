# Claim-validation suite

The independent oracle remains useful because it checks published arithmetic without calling the same production metric functions. It primarily preserves the original narrow replay and HEAT-SHIELD evidence claims; current daily-product behavior is covered by the backend, frontend and browser suites described in [testing.md](testing.md).

## What the independent tier establishes

- Published task-score and exposure arithmetic reproduce for the pinned replay.
- Schedule durations and encoded constraints reproduce independently.
- HEAT-SHIELD benchmark calculations and integrity metadata reproduce from the checked-in slice.
- Deployed compatibility responses repeat deterministically.

It does not establish medical safety, injury reduction, provider authenticity from checked-in JSON alone, universal optimizer optimality, hosting billing status or effectiveness outside the disclosed scenarios.

## Current daily-product checks

The normal test suite additionally verifies:

- the three curated daily examples and custom-site simulation flow;
- task-hour score, spatial offset, thermal burden, crew load and disruption formulas;
- deterministic single-day optimization and hard constraints;
- provider live/unavailable/exhausted/unconfigured states;
- header-only fallback, failed retry and successful transition to FortyGuard live;
- Markdown safety and map operation without WebGL.

## Trust tiers

1. **Offline:** hashes, independent formulas, fixtures, randomized cases and product tests.
2. **Deployed:** health/API behavior and public browser smoke tests.
3. **Provider verification:** optional read-only verification of recorded activity IDs with authorized FortyGuard access.

Checked-in provider-shaped JSON cannot authenticate its own origin. Activity IDs and hashes establish traceability and repository integrity; provider verification is a separate external tier.

## Commands

```bash
python3 scripts/run_claim_evaluation.py
python3 scripts/run_claim_evaluation.py --remote --repeat 3
python3 -m pytest -q
```

CI runs only offline tiers and never submits FortyGuard work. There is no expected-failure test: unsupported narrative claims are rejected or replaced with deterministic text.

## Threshold caution

Any percentage reduction must state its threshold and scenario. The earlier Phoenix replay produced 78.0% at score 50 but 29.3% at score 45. Neither percentage implies injuries prevented. The active daily console exposes formula, inputs, threshold, comparison and limitations for each metric.
