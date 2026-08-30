# Three-minute demo script

## Before recording

- Backend `/health` returns 200.
- Frontend opens in a private/incognito window.
- `POST /api/demo` completes and the map has 198 cells.
- Browser developer tools contain no API key.
- Use `FORTYGUARD_MODE=cached` for a stable video; the UI labels it as a saved real response.
- Evidence drawer shows both FortyGuard activity IDs.

## 0:00–0:20 · Problem

“A regional forecast cannot tell an HSE manager which work to move inside one industrial yard. Managers need an operational plan with evidence and constraints—not another weather card.”

Show the fictional Phoenix site, 12 workers, and the original 06:00–16:00 shift.

## 0:20–0:50 · Real evidence

Click **Run HeatShift Analysis**.

“HeatShift retrieves a real FortyGuard thermal field and environmental series. This replay contains 198 grid cells and 11 hourly observations. The heatmap activity and environmental activity remain attached to the decision.”

Point to the source badge, thermal map, apparent-temperature strip, and evidence drawer.

## 0:50–1:30 · Deterministic risk and optimization

“The LLM never calculates the official score. A versioned policy combines apparent temperature, workload, PPE, acclimatization, shade, and time. Every task shows its factors.”

Show the before/after timeline.

“Heavy cargo loading moves from 1:00 PM to 6:30 AM, dropping its peak screening score from 100 to 49. Asphalt repair moves from noon to 7:30 AM, dropping from 84 to 31. Fixed tasks remain fixed; dependencies, duration, and crew availability are preserved.”

## 1:30–2:00 · Measured result

“On this replay, exposed worker-minutes fall from 1,230 to 270—78%. Across three real FortyGuard replays, the aggregate is 3,690 to 810, also 78%, with 100% of scheduled task time retained.”

Show summary cards and `docs/evaluation.md` if desired.

## 2:00–2:25 · Agent and evidence

Open the evidence drawer.

“The agent runs six validated tools: retrieve evidence, load the shift, calculate risk, optimize, retrieve NIOSH guidance, and create alerts. If the model provider fails, the deterministic tool workflow still completes. Here is the full trace, source IDs, risk factors, and limitations.”

## 2:25–2:45 · Spectacles

Show the HUD and click **Acknowledge**.

“The optimized plan reaches the worker through a simulated spectacles interface. Buttons update only local demo state; this project does not claim physical hardware or push delivery.”

## 2:45–3:00 · Close

“HeatShift is screening support. It does not replace an on-site WBGT meter, emergency procedures, or a qualified safety professional. The next step is integration with real shift systems, field measurements, and supervisor workflows.”

