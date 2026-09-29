# Progress

Living status log. Update at the end of every session (see `AGENTS.md` §1).

## Current phase

**Phase 1 — Demand test** — code complete, PR open. Going live needs the owner's Cloudflare
setup (`docs/SETUP.md` §5).

## Done

- 2026-09-29 — **Phase 0** merged (asha-116/AI-Tools#1): repo layout, rules, docs, CI,
  templates, labels, agent procedures, policy drafts, stamp-duty schema.
- 2026-09-29 — **Phase 1** (this PR):
  - Astro 7 static site, `/` (EN) and `/hi/` (HI), mobile-first, system fonts, dark mode,
    strict CSP headers, hreflang/canonical/OG tags.
  - Landing page: 3 candidate ideas from `data/waitlist-ideas.json`, "Notify me" per idea,
    waitlist form with consent checkbox, honeypot, draft privacy note.
  - `workers/waitlist`: D1-backed Worker — validation, CORS allow-list, per-IP-hour rate limit
    (HMAC, never raw IP), idempotent on email + idea, no PII in logs, daily purge cron.
  - `deploy.yml`: Worker (migrations + deploy) and site (Pages) jobs; each skips cleanly until configured.
  - CI now also runs `astro check` and the site build. 61 tests; coverage 100% lines.
  - Verified locally end to end: built site + `wrangler dev` Worker with local D1 + Chromium —
    EN and HI sign-ups stored, duplicate ignored, foreign origin → 403, 6th request/hour → 429,
    no console errors.

## In progress

- Phase 1 PR review.

## Exact next step

1. Owner: `docs/SETUP.md` §5 (Cloudflare token, D1 database, GitHub secrets/variables), run
   **Deploy**, sign up once to confirm. Approve or edit the consent/privacy wording and the three ideas.
2. Engineer: once live, add a Lighthouse CI job (mobile ≥ 90) for the landing page, then start
   **Phase 2** with the EMI calculator — known-answer tests first (cite a bank's published EMI
   examples), then `tools-core/src/emi.ts`, then `site/src/tools/emi/`.

## Blockers

- **Going live** needs the owner's Cloudflare account, API token and D1 database (SETUP §5).
- **Branch protection on a private repo** needs GitHub Pro/Team, or the repo must be public
  (ADR-009).

## Questions for owner

1. **Name & contact:** owner name for legal pages, support email, and domain (or use `*.pages.dev`)?
2. **Profession:** confirm Indian real-estate agents (vs tuition teachers) as the first market.
3. **Brand:** keep "ToolShop"? It is generic and likely used elsewhere — a quick trademark
   search (ipindia.gov.in) is advised before spending on a domain. The site uses it as a placeholder.
4. **Private repo protection (ADR-009):** (a) make repo public once confirmed secret/PII-free —
   free protection + unlimited Actions minutes; (b) GitHub Pro (~US$4/month); (c) stay private
   with convention-only enforcement. Recommendation: (a).
5. **Licence:** keep proprietary "All rights reserved"?
6. **Delivery email (ADR-010):** free transactional email tier (needs a domain) or download
   link on the post-payment page only?
7. **Prices:** starting price points for the first two templates (suggest ₹199 and ₹299, bundle ₹399)?
   The landing page currently says only "small one-time price".
8. **Refund threshold:** max refund the Support agent may approve alone (suggest ₹0 until
   Phase 5 is proven, then ≤ ₹299)?
9. **States for stamp duty v1:** suggest Maharashtra, Karnataka, Delhi, Tamil Nadu, Uttar Pradesh.
10. **Hindi review:** who reviews Hindi copy before publishing? The landing page Hindi is a draft.
11. **GST / registration:** consult a CA before going live with payments.
12. **Waitlist consent & privacy wording** (new): approve the form's consent line and the
    "Your data" note in `site/src/i18n/strings.ts`, or send edits. It is the first place we
    collect personal data (DPDP Act 2023).
13. **Candidate ideas** (new, ADR-018): happy with stamp duty calculator / lead tracker /
    commission ledger as the three ideas to test?
