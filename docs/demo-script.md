# Three-minute demo script — recording guide only

Do not record or upload from an automated workflow. This is the final manual
guide for the user-owned video step.

## Before recording

- Backend `/health` returns 200.
- Frontend opens in a private/incognito window.
- `POST /api/demo` completes and the map has 198 cells.
- Browser developer tools contain no API key.
- Use `FORTYGUARD_MODE=cached` for a stable video; the UI labels it as a saved real response.
- Evidence drawer shows both FortyGuard activity IDs.
- Decision summary shows `2 / 4 / 2 / 100%`.
- HEAT-SHIELD panel loads all four headline metrics and five limitations.
- HUD says `HUD simulation` and `Supervisor action required`.

## 0:00–0:15 · Problem and hook

“Weather tells us how hot it will be. HeatShift tells an operations manager
which work can move, when it should move, and what risk remains.”

Show the fictional Phoenix site, 12 workers, and the original 06:00–16:00 shift.

## 0:15–0:40 · Real FortyGuard evidence

Click **Run HeatShift Analysis**.

“HeatShift retrieves a real FortyGuard thermal field and environmental series. This replay contains 198 grid cells and 11 hourly observations. The heatmap activity and environmental activity remain attached to the decision.”

Point to the source badge, thermal map, apparent-temperature strip, and evidence drawer.

## 0:40–1:25 · Workforce-aware optimization

“The LLM never calculates the official score. A versioned policy combines apparent temperature, workload, PPE, acclimatization, shade, and time. Every task shows its factors.”

Show the before/after timeline.

“Heavy cargo loading moves from 1:00 PM to 6:30 AM, dropping its peak screening score from 100 to 49. Asphalt repair moves from noon to 7:30 AM, dropping from 84 to 31. Fixed tasks remain fixed; dependencies, duration, and crew availability are preserved.”

## 1:25–1:50 · Measured operational result

“On this replay, exposed worker-minutes fall from 1,230 to 270—78%. Across three real FortyGuard replays, the aggregate is 3,690 to 810, also 78%, with 100% of scheduled task time retained.”

Show the primary metrics and decision summary. Say “worker-minutes above the
product screening threshold,” not “workers saved.” Point out that two movable
tasks changed, four fixed tasks were preserved, two residual alerts remain, and
100% of task time is retained.

## 1:50–2:15 · Human control and residual risk

Select a manager decision, show the remaining fixed-work alerts, and test one
worker HUD button.

“The manager remains in control. These buttons are browser-only simulation
state. No physical wearable, worker message, or supervisor notification is
connected.”

## 2:15–2:40 · Trustworthy AI

Open the evidence drawer.

“The agent runs six validated tools: retrieve evidence, load the shift, calculate risk, optimize, retrieve NIOSH guidance, and create alerts. If the model provider fails, the deterministic tool workflow still completes. Here is the full trace, source IDs, risk factors, and limitations.”

## 2:40–2:55 · External evidence

Scroll to the dashboard HEAT-SHIELD panel:

“Separately from the fictional operation, we apply this unchanged policy to 566
measured HEAT-SHIELD human-exposure sessions. The score's rank correlation with
measured one-hour work-capacity loss is 0.7718, and sessions at or above the
screening threshold average 36.45 percentage points more loss. This is
descriptive external evidence—not clinical or field-site validation.”

## 2:55–3:00 · Close

“HeatShift turns FortyGuard intelligence into a shift decision that protects
people while keeping operations moving.”

Keep the application visible throughout. Verify the final video is below 3:00,
opens without login, and does not use slides as a substitute for the working
product.
