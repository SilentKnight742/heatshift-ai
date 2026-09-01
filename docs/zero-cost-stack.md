# Zero-cost stack and controls

| Service | Use | Cost posture |
|---|---|---|
| Vercel Hobby | Next.js frontend and FastAPI serverless backend | Free hackathon deployment; no custom domain required |
| Supabase Free | Anonymous auth, Postgres, RLS and workspace persistence | Free project; documented limits fail closed rather than automatic database overage |
| Cloudflare Turnstile Free | Bot protection for live provisioning only | No Cloudflare proxy or paid plan required |
| OpenFreeMap | MapLibre vector style/tiles | No account/key; no SLA, so SVG/GeoJSON fallback is mandatory |
| Groq Free | Optional grounded explanation | Deterministic fallback preserves product function at rate limit/outage |
| FortyGuard hackathon credits | Historical environmental acquisition | Guarded by one-site quota, reservation, cache, idempotency and 200,000-credit reserve |

## No-surprise safeguards

- No Render service, paid database, custom domain, paid map key or automatic provider overage.
- Provider usage must be readable before work is submitted.
- Estimated cost is reserved atomically; requests that breach the global reserve fail closed.
- One live site-week per anonymous identity.
- Turnstile is checked server-side for token, action and allowed hostname.
- Geometry is capped at 10 mi² and granularity fixed at 100m.
- Identical requests share a request-hash cache and idempotency key.
- Completed paid stages are checkpointed and never repeated during retry.
- Curated caches and deterministic fallback keep the evaluation usable during outages.

The observed 64,240-credit estimate (`7×4,220 + 7×2,900 + 14,400`) is not a provider billing contract. Runtime code queries actual usage and fails closed.

## Account setup

1. Create a free Supabase project, enable anonymous sign-ins and apply the migration.
2. Create one free Turnstile widget allowing localhost, Vercel previews and production.
3. Add the public frontend keys to the frontend project and all secrets only to the backend project.
4. Keep `HEATSHIFT_LOCAL_AUTH=false` in Vercel.
5. Retain the existing FortyGuard and Groq keys server-side.

Vercel Hobby’s terms and resource ceilings still apply; this is a public hackathon proof of concept, not a commercial hosting commitment or SLA.
