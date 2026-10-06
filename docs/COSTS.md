# Costs and free-tier limits

Rule: **no paid component without an entry here and an owner-approved Issue.** Alerts fire at
70% of any limit (Phase 6). Limits below are from provider docs as understood on 2026-09-29 and
**must be re-checked on the provider's pricing page during setup** — update "Verified" when you do.

## Services

| Service                                | Used for                                   | Free-tier limit (to verify)                                                   | Current usage                  | Paid trigger                                                                   | Verified |
| -------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------ | -------- |
| GitHub (Free) — repo, Issues, Projects | company OS                                 | unlimited private repos                                                       | —                              | —                                                                              | not yet  |
| GitHub Actions                         | CI + agent heartbeats                      | private repos: 2,000 min/month; public repos: unlimited on standard runners   | 0                              | > 2,000 min/month on private → make public or pay                              | not yet  |
| GitHub branch protection               | required checks on `main`                  | public repos only on Free                                                     | n/a                            | private + protection → GitHub Pro                                              | not yet  |
| Cloudflare Pages                       | static site                                | 500 builds/month, unlimited static requests/bandwidth                         | 0                              | builds > 500 (we deploy via Actions, so few)                                   | not yet  |
| Cloudflare Workers                     | waitlist, payments, download (3 Workers)   | 100,000 requests/day, 10 ms CPU/request                                       | 0 (not yet deployed)           | sustained > 70k/day                                                            | not yet  |
| Cloudflare D1                          | waitlist (from Phase 1), orders            | 5 GB, 5M rows read/day, 100k rows written/day                                 | 0 (≤ 2 row writes per sign-up) | —                                                                              | not yet  |
| Cloudflare KV                          | not used (D1 handles idempotency, ADR-023) | 100k reads/day, 1k writes/day, 1 GB                                           | 0                              | writes > 1k/day                                                                | not yet  |
| Cloudflare R2                          | paid product files                         | 10 GB-month, 1M class A + 10M class B ops/month, free egress                  | 0                              | > 10 GB                                                                        | not yet  |
| Cloudflare Web Analytics               | traffic                                    | free                                                                          | —                              | —                                                                              | not yet  |
| Razorpay                               | payments                                   | no setup/annual fee                                                           | 0                              | **per-transaction fee (~2% + 18% GST on the fee)** — unavoidable cost of sales | not yet  |
| Transactional email (Resend, proposed) | buyer emails — not used yet (ADR-023)      | 3,000/month, 100/day; needs a domain                                          | 0                              | > 100 sales/day                                                                | not yet  |
| Gemini API                             | agents                                     | free tier with per-model RPM/RPD limits; **prompts may be used for training** | 0                              | —                                                                              | not yet  |
| Groq                                   | agents                                     | free tier, per-model rate limits                                              | 0                              | —                                                                              | not yet  |
| Cerebras                               | agents                                     | free tier, daily token limits                                                 | 0                              | —                                                                              | not yet  |
| OpenRouter (free models)               | agents fallback                            | ~50 requests/day on `:free` models without credits                            | 0                              | —                                                                              | not yet  |
| Ollama (local)                         | optional offline fallback                  | free (owner's machine)                                                        | —                              | —                                                                              | n/a      |
| Domain (optional)                      | brand + email sending                      | **paid, ~₹800–1,500/year**                                                    | —                              | owner decision                                                                 | n/a      |

## Cost-bearing items awaiting owner decision

- **Domain** — needed for branded email delivery (ADR-010). Optional otherwise.
- **GitHub Pro** — only if the repo stays private _and_ branch protection is wanted (ADR-009).
- **Razorpay fees** — cost of sales, not avoidable; tracked by the Controller.

## Actions minutes budget (private repo)

| Workflow                                     | Runs/month (est.) | Minutes/run (est.)                                        | Minutes/month       |
| -------------------------------------------- | ----------------- | --------------------------------------------------------- | ------------------- |
| CI (per PR/push)                             | 120               | 9 (4 parallel jobs; Lighthouse ~8 min: 14 pages × 3 runs) | 1,080               |
| Orchestrator (daily)                         | 30                | 1                                                         | 30                  |
| Controller (daily)                           | 30                | 1                                                         | 30                  |
| Demand Researcher (weekly)                   | 4                 | 3                                                         | 12                  |
| Support (every 2 h)                          | 360               | 1                                                         | 360                 |
| Builder / SEO / Social / Verifier (per task) | 60                | 3                                                         | 180                 |
| **Total**                                    |                   |                                                           | **≈ 1,690 / 2,000** |

GitHub bills each job rounded up to the whole minute, so many tiny jobs cost more than they
look. Keep jobs short, cache `npm`, and combine steps. If usage passes 70%, reduce Support to
every 4 hours or make the repo public (ADR-009).
