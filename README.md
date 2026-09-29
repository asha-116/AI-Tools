# ChangeLens

**Live at https://tools.changelense.in**

Small, practical digital tools for **Indian real-estate agents**: free web calculators
(EMI, stamp duty + registration, commission split, rental yield, loan eligibility) and low-cost
paid templates (₹99–₹999) — in English and Hindi.

The business is run by **AI agents** defined in this repository. One human, the **owner**,
acts as the board: approving money, legal text, public claims and anything irreversible.
Everything runs on free tiers (GitHub, Cloudflare, free LLM APIs).

> **Status:** Phase 1 done (site live, waitlist recording); Phase 2 (free calculators) in progress. See [`docs/PROGRESS.md`](docs/PROGRESS.md) for the live
> state and the exact next step.

## How the company maps onto this repo

| Company concept     | Where                                                          |
| ------------------- | -------------------------------------------------------------- |
| Tasks / tickets     | GitHub Issues + labels (`agent:*`, `type:*`, `needs-owner`)    |
| Agent heartbeat     | Scheduled GitHub Actions in `.github/workflows/`               |
| Work output         | Pull Requests from `agent/<name>/<slug>` branches              |
| QA gate             | CI checks + Verifier agent on PRs to `main`                    |
| Company memory      | `company/` (goals, policies, knowledge base, reports, ledger)  |
| Storefront          | `site/` → Cloudflare Pages                                     |
| Payments + delivery | Razorpay → `workers/payment-webhook` → R2 → `workers/download` |

Full diagrams: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```
docs/          architecture, progress, roadmap, decisions, costs, runbook, setup
site/          static storefront (Astro) — calculators + SEO content, EN + HI
tools-core/    pure TypeScript formula functions, 100% unit-tested, no UI
products/      paid templates: source, spec.json, changelog, test cases
data/          reference data with sources (e.g. stamp-duty/<STATE>.json)
workers/       Cloudflare Workers: waitlist, payment-webhook, download
agents/        the AI workforce: lib/ + one folder per agent (PROCEDURE.md first)
company/       goals, policies, knowledge base, memory, ledger, reports
legal/         terms, privacy, refund, contact — owner must approve
scripts/       repo tooling (structure check, backups)
```

## Run locally

Requires Node 22 (`.nvmrc`).

```bash
npm ci
npm run ci        # lint, format, typecheck, astro check, tests + coverage, site build, structure check
npm run dev -w @toolshop/site   # site at http://localhost:4321
```

Waitlist Worker locally: [`docs/SETUP.md`](docs/SETUP.md) §5.4.

## Continue the work

Any engineer or AI agent can resume by reading, in order:

1. this `README.md`
2. [`AGENTS.md`](AGENTS.md) — the rules
3. [`docs/PROGRESS.md`](docs/PROGRESS.md) — what's done, what's next, blockers

Owner setup (accounts, secrets, branch protection): [`docs/SETUP.md`](docs/SETUP.md).
Weekly owner routine (≤ 2 hours): [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Licence

Proprietary — all rights reserved. See [`LICENSE`](LICENSE).
