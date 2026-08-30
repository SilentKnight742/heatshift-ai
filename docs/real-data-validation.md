# Empirical HEAT-SHIELD benchmark

HeatShift's Phoenix site, crews, tasks, and schedule remain a fictional product
demonstration. The project now has a separate empirical benchmark built from
measured human heat-exposure trials. This distinction matters: the benchmark
tests whether the existing screening score aligns with a real physiological work
outcome; it does not turn the demo operation into a real workplace study.

## Why this source was selected

The public [HEAT-SHIELD dataset](https://doi.org/10.6084/m9.figshare.25722300.v1)
is the best zero-cost proof-of-concept source found because it contains both the
exposure side and the outcome side of the question:

- measured air temperature, relative humidity, air speed, and experimental solar
  conditions;
- clothing-coverage conditions plus calculated Apparent Temperature, Heat Index,
  outdoor WBGT, and UTCI;
- measured one-hour physical work capacity (PWC) loss for pseudonymous
  participants;
- a CC BY 4.0 license, stable DOI, source-workbook checksum, and research-paper
  methodology;
- controlled trials spanning air temperatures from 14.311°C to 50.786°C rather
  than synthetic scenario rows.

The associated open-access [Journal of Applied Physiology
paper](https://doi.org/10.1152/japplphysiol.00613.2023) describes fixed-heart-rate
treadmill trials across varied temperature, humidity, air velocity, solar load,
and clothing conditions. The research was funded through the European Union's
HEAT-SHIELD Horizon 2020 project (grant 668786).

## Sources considered but not used as the primary benchmark

| Source | What is real and useful | Why it is not the primary outcome benchmark |
|---|---|---|
| [NOAA Integrated Surface Database](https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database) | Free global hourly weather observations | Adds another environmental feed but no worker outcome, PPE, workload, or schedule |
| [National Weather Service API](https://www.weather.gov/documentation/services-web-api) | Free forecasts, alerts, and observations | Useful for future live context, not a controlled historical worker-response dataset |
| [Arizona 511 WZDx feed](https://az511.com/api/wzdx) | Live, no-key public work-zone records including some worker-presence flags | No worker count, work intensity, PPE, acclimatization, outcome, or trustworthy exposure duration; it cannot support worker-minute claims |
| [Arizona heat-related illness report](https://www.azdhs.gov/documents/preparedness/epidemiology-disease-control/extreme-weather/pubs/heat-related-illness-emergency-department-and-inpatient-admissions-in-arizona-by-year-2020-2024.pdf?v=20250517) | Real statewide emergency-department visits and hospital admissions | Population-level aggregate with no link to a job, exposure, schedule, or HeatShift decision |
| [Maricopa County Heat Surveillance](https://hsd.maricopa.gov/1858/Heat-Surveillance) | Real local heat-associated illness and death surveillance | Aggregate public-health surveillance, not trial-level occupational exposure and work capacity |
| [OSHA Severe Injury Reports](https://www.osha.gov/severe-injury-reports) | Public severe-injury records from covered federal-jurisdiction employers | No exposure denominator or schedule linkage; Arizona also operates an [OSHA-approved State Plan](https://www.osha.gov/stateplans/AZ) |

These sources remain candidates for future contextual layers. Combining them
would not create valid worker-level labels, so HeatShift does not join unrelated
records or fabricate missing fields.

## Reproducible data slice

The source workbook is
`D2 DATASET FINAL HEATSHIELD individual sessions March 2024 PWC6.xlsx`
(Figshare file `46004385`, MD5
`e36962603afbdbd6e9856936aacab62f`). Its explanation sheet says source studies
1–6 contain the complete one-hour modelling trials and studies 7–14 are duplicate
subsets for within-subject comparisons. HeatShift therefore selects only studies
1–6, avoiding double-counting.

The resulting slice contains:

| Property | Value |
|---|---:|
| Trial sessions | 566 |
| Pseudonymous participants | 32 |
| Source study groups | 1–6 |
| Derived CSV size | about 92 KB |
| Derived CSV SHA-256 | `f80db381ab856b5720a84f27090c9b7988ff17bf29998f800b73458b8f1113d9` |
| Runtime API or account required | No |
| License | CC BY 4.0 |

Regenerate and audit it with:

```bash
python3 scripts/prepare_heatshield_validation.py
sha256sum data/validation/heatshield_trials.csv
```

The script downloads the public workbook, verifies its published MD5, parses the
Excel file using only Python's standard library, selects and validates the 566
records, and writes a deterministic CSV. The complete field definitions,
transformation statement, citations, hashes, and limitations are in
`data/validation/heatshield_provenance.json`.

## Fixed benchmark profile

The benchmark deliberately does not fit coefficients or thresholds to the
HEAT-SHIELD outcome. It applies policy v1.0.0 exactly as it already existed:

```text
score = points for source Apparent Temperature
      + 18 for a standardized heavy-work profile
      + 0 for standardized acclimatized status
      + 10 when the source condition used a coverall, otherwise 0
      + 6 when the source solar condition was active, otherwise 0
```

The heavy-work standardization reflects the trial protocol's fixed heart-rate
target near the moderate/heavy boundary. Acclimatization was not provided as a
trial-level field, so one fixed status is used for every record. This enables a
consistent product-policy comparison without pretending the source contains
facts that it does not.

## Measured results

All correlations below are descriptive across repeated trial sessions. They do
not assume that the 566 records are statistically independent.

| Metric | Result |
|---|---:|
| HeatShift score vs measured PWC loss, Pearson `r` | 0.7744 |
| HeatShift score vs measured PWC loss, Spearman `rho` | 0.7718 |
| Environmental score component vs measured PWC loss, Spearman `rho` | 0.8133 |
| Mean PWC loss below score 50 | 14.37% (248 sessions) |
| Mean PWC loss at/above score 50 | 50.82% (318 sessions) |
| Difference between threshold groups | 36.45 percentage points |

### Product-band breakdown

| HeatShift band | Sessions | Score range observed | Mean measured PWC loss | Median | Interquartile range |
|---|---:|---:|---:|---:|---:|
| Moderate | 248 | 26–48 | 14.37% | 11.52% | 0.00–23.18% |
| High | 201 | 50–73 | 47.18% | 44.20% | 32.08–67.05% |
| Critical | 117 | 79–89 | 57.07% | 59.04% | 43.72–72.77% |

There are no low-band observations under the standardized heavy-work profile;
that is a property of this benchmark, not a missing category.

### Comparison with source heat indices

| Index | Pearson `r` | Spearman `rho` |
|---|---:|---:|
| Apparent Temperature | 0.8425 | 0.8688 |
| Heat Index | 0.8612 | 0.8516 |
| Outdoor WBGT | 0.8263 | 0.8838 |
| UTCI | 0.8583 | 0.8732 |

This comparison is intentionally visible. The coarse HeatShift score is useful
for operational prioritization but does not outperform the continuous research
indices. The source paper likewise cautions that Apparent Temperature is less
robust than UTCI or WBGT when wind and solar conditions vary. A later policy
version should evaluate a WBGT/UTCI-based environmental component rather than
hiding this limitation.

## API contract for the frontend

`GET /api/validation/heatshield` returns the dataset identity and license,
integrity hashes, fixed benchmark assumptions, threshold and band metrics, input
ranges, comparative correlations, citations, interpretation, and limitations.
It performs no network call and uses no LLM or paid service.

Frontend evidence cards can safely display these four headline values:

- **566 measured trial sessions**;
- **32 pseudonymous participants**;
- **0.7718 rank correlation** between the fixed HeatShift score and measured
  one-hour PWC loss;
- **36.45 percentage-point higher mean loss** at/above the product threshold.

The UI must keep the qualifier “controlled human-exposure trials” and must not
rewrite PWC loss as illnesses prevented, injury risk, real Phoenix workers, or
regulatory validation.

## Limitations and correct claim language

Use: “The existing HeatShift screening policy shows descriptive alignment with
measured physical work-capacity loss in 566 controlled heat-exposure sessions.”

Do not use: “HeatShift is clinically validated,” “predicts heat illness,” “saved
workers,” or “was validated at a Phoenix worksite.”

The benchmark is a meaningful proof of concept because the input conditions and
outcome are measured. It is not a prospective field evaluation, clinical study,
causal estimate, or substitute for on-site WBGT measurements and qualified safety
judgment.
