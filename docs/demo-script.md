# Judge demo walkthrough

Target: 3–4 minutes.

## 1. Problem and evidence — 35 seconds

Open the homepage. Say: “A weather map tells an operations manager where it is hot. HeatShift answers what to do with this week’s jobs and crews without hiding the operational cost.” Show the five-step flow and three decision dimensions. Briefly show the HEAT-SHIELD result and say it is descriptive human-exposure evidence, not an injury-reduction claim.

## 2. Portfolio and time — 35 seconds

Open Console. Dismiss or follow the walkthrough. Switch state, portfolio/site mode, day and hour. Point out the state boundary, site burden color, hourly chart, spatial cells, active work and the label distinguishing real provider evidence, fictional operation and derived estimates.

## 3. Manager inputs — 45 seconds

Open Sites/Crews/Jobs. Show editable worker count, PPE, acclimatization, workload, eligible crews, dependencies, shade, mobility and status. Create a site dialog and demonstrate a map-drawn polygon or circle without submitting a live provider request. Explain the 10 mi² limit, inferred timezone, one-site quota and reserve.

## 4. Compare and act — 60 seconds

Switch Original → HeatShift → Working. Show the unchanged Original layer, the proposal and the editable Working layer. Apply one movement, drag a pending job, drop an eligible crew on it, undo, then reset. Attempt one invalid edit if reliable and show the exact constraint. Mark work deferred or cancelled and show that no job is automatically completed by the clock.

## 5. Explain the result — 40 seconds

Open each primary metric. Say:

- Site Thermal Burden describes weekly heat intensity/persistence.
- Crew Exposure Load makes cumulative worker-weighted assignment visible.
- Operational Disruption reports logistics separately, not as an opaque score.

Show the formula and inputs before clicking Ask AI. The AI explains authoritative numbers; it cannot change them, and unsupported numeric prose is discarded.

## 6. Resilience and boundary — 25 seconds

Switch to “Use SVG fallback.” Explain that MapLibre/OpenFreeMap is the richer view, while the same GeoJSON thermal data remains functional without WebGL or tiles. End on the safety notice: screening-level planning only; verify with on-site WBGT and qualified judgment.

## Pass/fail before recording

- Seven days and 24 hours navigate without stale location/time evidence.
- Original remains immutable; Working accepts valid edits and rejects invalid ones.
- Markdown headings/lists render without visible asterisks; raw HTML never executes.
- Site/crew/job CRUD persists after refresh when Supabase is configured.
- SVG fallback displays cells and job/site selection.
- No removed wearable feature or outdated single-day product claim appears.
- Mobile setup panel collapses and timeline scrolls horizontally without page overflow.
