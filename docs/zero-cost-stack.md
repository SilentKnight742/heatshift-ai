# Zero-cost stack and controls

| Service | Current use | Cost posture |
|---|---|---|
| Vercel Hobby | Next.js frontend and FastAPI backend | Free public demonstration; no custom domain |
| Supabase Free | Anonymous hosted identity and RLS-scoped daily workspace snapshots | Free tier; service secret remains backend-only |
| Leaflet + OpenStreetMap | Interactive state/site map | No map API key; standard attribution retained |
| Groq Free | Optional activity-name enrichment | Deterministic label fallback keeps generation functional |
| FortyGuard hackathon credits | Cached built-in evidence and read-only availability check | No provider analysis is submitted by console status/retry |
| Local simulation | Custom-site weather and operations | Deterministic, free and explicitly labelled |

## No-surprise safeguards

- No Render service, paid database, paid map key, custom domain or automatic provider overage.
- Provider status uses a read-only usage request and is cached for five minutes.
- Retry bypasses only that cache; it still does not submit a provider job.
- Unavailable, unconfigured or exhausted provider states keep the console in Simulated run.
- TLS verification is never disabled.
- Geometry is constrained to the selected state and 10 mi².
- Curated evidence stays checked into the repository, so the three demonstrations survive provider outages.
- Deterministic briefing and activity names remain available without a hosted LLM.
- CI never contacts FortyGuard.

## Account setup

1. Create a free Supabase project and enable anonymous sign-ins.
2. Keep the existing FortyGuard and Groq keys server-side.
3. Add public Supabase variables only to the frontend Vercel project.
4. Add Supabase secrets, FortyGuard and Groq keys only to the backend project.
5. Keep `HEATSHIFT_LOCAL_AUTH=false` in Vercel.

Cloudflare Turnstile and the former live site-week provisioning flow remain in legacy backend modules but are not part of the current daily console path.

Vercel Hobby, Supabase Free, OpenStreetMap and free model/provider tiers provide no commercial production SLA. This is a public proof of concept.
