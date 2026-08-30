# Submission description

## HeatShift AI — operational heat decisions for industrial shifts

Regional weather forecasts cannot reveal worksite-level heat variation, and a heatmap alone does not tell an HSE manager what to change. HeatShift AI turns hyperlocal temperature intelligence into a constraint-checked work plan before crews clock in.

The demo uses one fictional Phoenix logistics yard, three fictional crews (12 workers), and six tasks. HeatShift retrieves a real FortyGuard thermal field and hourly environmental parameters, calculates screening-level task risk, reschedules flexible heavy work, and formats explainable actions for a simulated smart-spectacles interface.

FortyGuard is central and visible. The primary replay contains 198 real 100 m heatmap cells and 11 hourly environmental observations. Every decision retains its heatmap activity ID, environmental activity ID, timestamp, live/cached state, parameters, and limitations. Saved responses come only from completed real activities; the product never silently generates weather.

Safety calculations are deterministic and independent of the LLM. A versioned JSON policy combines returned apparent temperature with task workload, PPE burden, crew acclimatization, shade, and configured solar hours. The greedy optimizer evaluates 30-minute starts while preserving fixed tasks, shift bounds, dependencies, duration, and crew availability. An optional Responses-compatible agent executes six validated tools and exposes its trace; if the provider fails, the same tool workflow completes deterministically.

On the main replay, HeatShift moves heavy cargo loading from 1:00 PM to 6:30 AM and asphalt repair from noon to 7:30 AM. Worker-minutes at or above the configured screening threshold fall from 1,230 to 270. Across three completed real FortyGuard historical replays, aggregate exposure falls from 3,690 to 810—a **78.0% reduction**—while retaining **100% of scheduled task time**.

The single-page dashboard includes the thermal map, hourly conditions, before/after timeline, manager controls, agent trace, evidence drawer, and interactive worker HUD. Map rendering degrades to real-GeoJSON SVG when WebGL is unavailable; LLM or map failure never removes the deterministic schedule result.

HeatShift provides screening-level decision support. It does not present FortyGuard values as measured on-site WBGT, make medical diagnoses, estimate injuries prevented, or replace a qualified safety professional and worksite measurement.

