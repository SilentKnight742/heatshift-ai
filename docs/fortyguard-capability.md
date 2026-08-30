# FortyGuard capability gate

Gate completed August 29, 2026.

| Check | Result |
|---|---|
| API-key authentication | Passed |
| Closed Phoenix polygon accepted | Passed |
| Activity ID returned | Passed |
| Bounded polling completed | Passed |
| Non-empty GeoJSON parsed | Passed: 198 cells |
| Environmental endpoint accessible | Passed: 11 hourly observations |
| Real response saved | Passed |

Main replay activities:

- Heatmap: `81e55f4d-b51b-4dcc-bd4f-ab4e6c527002`
- Environmental parameters: `eb97f401-3e22-44e1-a537-a86a0aa912db`

The first accepted polygon was smaller than one 100 m grid cell and completed with zero features. It was not used. The final approximately 1.8 km² polygon completed with 198 features. This is why the production normalizer rejects a completed response with no map cells.

The actual response matched the published top-level shape. Heatmap tile temperature appears in `properties.average_temperature`; environmental arrays include `apparent_temperature_celsius`, `heat_index_celsius`, `relative_humidity_percent`, and `wet_bulb_temperature_celsius`. Clear-sky GHI/DNI/DHI are summary values for the time range.

No API key or signed URL is stored in the repository.

