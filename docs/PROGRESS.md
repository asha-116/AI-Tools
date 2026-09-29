# Progress

Living status log. Update at the end of every session (see `AGENTS.md` §1).

## Current phase

**Phase 0 — Foundation** — PR open, waiting for CI + owner review.

## Done

- 2026-09-29 — Phase 0 scaffold: repo layout, README/AGENTS/CLAUDE, all docs, `.env.example`,
  proprietary licence, CI (lint, format, typecheck, tests with 95% coverage gate, gitleaks,
  offline link check, structure check), Issue/PR templates, labels + sync workflow,
  CODEOWNERS, Dependabot, `PROCEDURE.md` for all nine agents, company policy drafts,
  stamp-duty data schema, `tools-core` numeric helpers with tests.
- An empty root commit was pushed to `main` so the Phase 0 PR has a base branch.

## In progress

- Phase 0 PR review.

## Exact next step

1. Owner: work through `docs/SETUP.md` §1–§3 (accounts, branch protection decision, labels sync)
   and answer the questions below.
2. Engineer: start Phase 1 — scaffold Astro in `site/` (EN + HI routes), add `deploy.yml`
   (Cloudflare Pages direct upload, skipped when secrets are absent), landing page with 3
   candidate ideas, waitlist Worker + D1. Record Astro + D1 choices as accepted ADRs.

## Blockers

- **Branch protection on a private repo** needs GitHub Pro/Team, or the repo must be public
  (ADR-009). Until decided, "agents never merge" is enforced by workflow permissions and
  convention only.
- Deploys need the owner's Cloudflare account + API token (SETUP §2).

## Questions for owner

1. **Name & contact:** owner name for legal pages, support email, and domain (or use `*.pages.dev`)?
2. **Profession:** confirm Indian real-estate agents (vs tuition teachers) as the first market.
3. **Brand:** keep "ToolShop"? It is generic and likely used elsewhere — a quick trademark
   search (ipindia.gov.in) is advised before spending on a domain.
4. **Private repo protection (ADR-009):** (a) make repo public once confirmed secret/PII-free —
   free protection + unlimited Actions minutes; (b) GitHub Pro (~US$4/month); (c) stay private
   with convention-only enforcement. Recommendation: (a) — nothing in the repo is secret by
   design; paid template files live in R2, not git.
5. **Licence:** keep proprietary "All rights reserved"? (Matters more if the repo goes public.)
6. **Delivery email (ADR-010):** OK to use a free transactional email tier (e.g. Resend
   3,000/month) — requires a domain — or show the download link only on the post-payment page
   and via Razorpay's receipt?
7. **Prices:** starting price points for the first two templates (suggest ₹199 and ₹299, bundle ₹399)?
8. **Refund threshold:** max refund the Support agent may approve alone (suggest ₹0 until
   Phase 5 is proven, then ≤ ₹299, within 7 days, once per buyer)?
9. **States for stamp duty v1:** suggest Maharashtra, Karnataka, Delhi, Tamil Nadu, Uttar Pradesh.
10. **Hindi review:** who reviews Hindi copy for money/legal terms before publishing?
11. **GST / registration:** consult a CA before going live with payments (agents will not advise).
