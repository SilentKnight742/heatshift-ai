# FortyGuard capability and runtime status

The acquisition gate completed on August 29, 2026 and established the provider contract used by the cached built-in evidence and compatibility APIs.

| Check | Result at acquisition |
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

The first accepted polygon was smaller than one 100 m cell and completed with zero features, so it was not used. The final approximately 1.8 km² polygon completed with 198 features. Production normalization rejects a completed map response with no cells.

Heatmap temperature is provided in `properties.average_temperature`. Environmental arrays include apparent temperature, heat index, relative humidity and wet-bulb temperature. Clear-sky GHI/DNI/DHI are time-range summaries.

## Runtime status contract

The active daily console does not assume that this historical capability result means the provider is currently reachable. On load it calls `GET /api/daily/provider-status`, which performs a read-only usage request and returns one of:

- `available`;
- `provider_unavailable`;
- `credits_exhausted`;
- `not_configured`.

The result is cached for five minutes. Header Retry sends `refresh=true`. Failure keeps the console in Simulated run; success shows FortyGuard live. No heatmap activity is submitted and no TLS check is bypassed.

The current daily custom-site path remains simulated even when provider status is live. Live status proves provider reachability only.

No API key, token or signed URL is stored in the repository.
