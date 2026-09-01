# Claim-validation suite

The independent oracle remains necessary because it checks published arithmetic without reusing production metric functions. It has been updated for the weekly product rather than removed.

## What it establishes

- Task-hour scores follow the disclosed policy.
- Original, HeatShift and Working schedule entries preserve durations and required constraints.
- Exposure, thermal burden, crew load and disruption arithmetic are reproducible.
- Deterministic runs repeat identically for the same evidence and operation.
- The API cannot accept a client-invented score/end/source as authoritative.
- Model prose cannot alter structured results; unsupported numbers and contradictions select deterministic fallback.
- HEAT-SHIELD benchmark calculations and integrity metadata reproduce from the checked-in slice.

It does **not** establish medical safety, injury reduction, provider authenticity from checked-in JSON alone, universal optimizer optimality, Vercel billing status, or effectiveness outside the disclosed scenarios.

## Trust tiers

1. **Offline:** hashes, independent formulas, randomized differential cases, mutation tests and fixture contracts.
2. **Deployed:** health/API behavior and deterministic repetition against the public service.
3. **Provider verification:** optional read-only verification of recorded activity IDs using authorized FortyGuard access.

Checked-in provider-shaped JSON cannot authenticate its own origin. Activity IDs plus hashes establish traceability and repository integrity; provider verification is a separate external tier.

## Commands

```bash
python3 scripts/run_claim_evaluation.py
python3 scripts/run_claim_evaluation.py --remote --repeat 3
```

The suite is part of CI in offline mode. CI never calls FortyGuard. Current complete backend baseline is 102 passes and zero expected failures. The previous expected-failure narrative test was replaced by a real grounding guard and passing rejection/fallback tests.

`claim_evaluation/evidence_manifest.json` now pins all five curated site-week hashes and their 75 completed provider activity IDs. Together with the six legacy replay IDs, `--verify-provider` checks 81 completed activities read-only. The manifest also records two abandoned environmental IDs that remained indefinitely in `Processing`; completed replacement activities are the inputs actually used.

## Threshold caution

Any percentage reduction must state its threshold and scenario. The earlier Phoenix result was 78.0% at score 50 but 29.3% at score 45. Neither percentage implies injuries prevented. Weekly metric cards expose formula, inputs, threshold, comparison and limitations so the claim can be independently audited.
