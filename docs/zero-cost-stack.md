# Zero-cost deployment policy

HeatShift AI's public hackathon deployment must remain usable without a paid
subscription, payment method, custom domain, or usage-based overage bill.

| Capability | Choice | Cost guardrail |
|---|---|---|
| Source and CI | Public GitHub repository and GitHub Actions | Public-repository Actions usage is free. |
| Backend | Vercel Hobby Python Function | Hobby has no usage overage billing; the deployment can pause at its limits. |
| Frontend | Vercel Hobby Next.js deployment | Uses the included `vercel.app` domain and HTTPS. |
| LLM | Groq free plan, `openai/gpt-oss-120b` | Rate-limited; deterministic analysis remains available when the LLM is unavailable. |
| Heat evidence | Saved responses from successful real FortyGuard activities | Production defaults to `FORTYGUARD_MODE=cached`, so ordinary demos consume no API credits. |
| Map | MapLibre plus OpenStreetMap public tiles | No API key; retain the built-in SVG fallback and keep traffic at demo scale. |
| Storage | Bundled JSON plus ephemeral in-memory state | No hosted database or durable user data. |
| Monitoring | Vercel's included runtime logs | No paid observability service. |
| Domain and TLS | Generated `vercel.app` domains | No domain purchase or certificate charge. |

## Hard constraints

- Do not add a service that requires a paid plan or automatic overage billing.
- Do not enable live FortyGuard mode on the public deployment unless consuming
  its credits is an explicit demonstration choice.
- Do not add a database, queue, analytics product, custom domain, or paid map
  provider for the hackathon slice.
- Do not place provider keys in browser-exposed variables or Git history.
- If any free allowance is exhausted, the product must fail closed or fall back;
  it must never silently incur a charge.

## Scope limitation

Vercel Hobby is intended for personal, non-commercial projects. This is therefore
a public demo deployment, not the final hosting plan for a commercial HeatShift
service. A commercial launch would require a separate infrastructure and budget
decision.
