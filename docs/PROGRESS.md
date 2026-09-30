# Progress

Living status log. Update at the end of every session (see `AGENTS.md` §1).

## Current phase

**Phase 2 — Free calculators.** EMI and commission live; stamp duty built, waiting for rate verification. Phase 1 is done: the site is live at
**https://tools.changelense.in** and the waitlist records sign-ups (first one confirmed
2026-09-29). Brand is now **ChangeLens** (ADR-019). Phase 1 is merged; going live
still needs the owner's Cloudflare setup (`docs/SETUP.md` §5).

## Done

- 2026-09-29 — **Phase 0** merged (asha-116/AI-Tools#1): repo layout, rules, docs, CI,
  templates, labels, agent procedures, policy drafts, stamp-duty schema.
- 2026-09-29 — **Phase 2, part 4: stamp duty calculator** (this PR):
  - `tools-core/src/stampDuty.ts`: data-driven rules (area, buyer, value slabs, surcharges on
    value or on duty, registration % with cap/min/fixed fee); tests first with hand-checked
    fixture cases.
  - Draft data for MH, KA, DL, TN, UP from web-search summaries, each with `official_source`
    and the conflicts found between sources. **Not verified** — official portals were blocked
    from the build environment (ADR-022).
  - `/tools/stamp-duty/` (EN + HI): live site shows “coming soon” (noindex) until a state is
    verified; `#drafts` shows drafts under a red banner for owner review.
  - Lighthouse CI covers the page (SEO excluded while noindex). 182 tests.
  - Known gap: rule descriptions and surcharge names come from the data files in English;
    add Hindi fields before publishing.
- 2026-09-29 — **Go-live + rebrand** merged (asha-116/AI-Tools#8, together with Lighthouse CI):
  - Owner deployed via `docs/SETUP.md` §5; custom domain `tools.changelense.in` active;
    sign-up round trip verified in D1.
  - Brand renamed to ChangeLens (user-facing only; internal ids unchanged — ADR-019).
  - SETUP now covers the two traps we hit: `toolshop.pages.dev` is someone else's site, and
    adding the DNS record by hand blocks _Activate domain_ (Error 523).
  - Site no longer falls back to `toolshop.pages.dev` when `SITE_URL` is unset; Deploy prints
    the Pages address it deployed to.
- 2026-09-29 — **Phase 2, part 3: Lighthouse CI** (this PR): new CI job builds the site and runs
  Lighthouse (mobile emulation) on all 6 pages; fails if performance, accessibility,
  best practices or SEO drops below 90. Reports uploaded as an artifact on failure. Verified
  locally that it passes (all 100) and that a failing threshold exits non-zero.
  **Add a new page's URL to `lighthouserc.json`** whenever a tool is added.
- 2026-09-29 — **Phase 2, part 2: commission split calculator** merged (asha-116/AI-Tools#7):
  - `tools-core/src/commission.ts`, tests first: 10 published worked examples (Indian
    brokerage + 18% GST; 50/50 and 70/30 splits). All money in whole paise; party shares use
    largest-remainder allocation so they always add up to the gross exactly.
  - `/tools/commission/` and `/hi/tools/commission/`: % of deal or fixed amount, optional
    GST % (user-entered, default 0 — no tax rate is hard-coded), 1–6 people with editable
    names, live "shares add up to X%" check, shareable hash link.
  - TDS deliberately left out (sources disagree on the current rate; tax question for a CA).
  - Fixed a site-wide CSS bug: `display: grid` was overriding the `hidden` attribute.
  - Verified in Chromium: published case ₹1 crore × 2% + 18% GST = ₹2,36,000; HTML in a name
    is shown as text (no injection), also via shared link; zero off-site requests.
    Lighthouse mobile 100/100/100/100 on commission EN/HI.
- 2026-09-29 — **Phase 2, part 1: EMI calculator** merged (asha-116/AI-Tools#6):
  - `tools-core/src/emi.ts` with tests written first: 12 published Indian EMI examples
    (`tools-core/test/fixtures/emi-known-answers.json`), all recomputed independently and
    matching to the rupee, plus identities (schedule pays off to zero, 0% rate, 1 month).
    One car-loan example was rejected because its sources disagree.
  - `/tools/emi/` and `/hi/tools/emi/`: live results, inline errors, shareable link (inputs in
    the URL hash, never sent to a server), formula, assumptions, disclaimer. Linked from home.
  - Verified in Chromium: shared link restores inputs, zero off-site requests, no console errors.
    Lighthouse mobile 100/100/100/100 on EMI EN/HI and the home page.
- 2026-09-29 — **Phase 1** merged (asha-116/AI-Tools#5):
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

- Stamp duty calculator PR review; owner verification of state rates (RUNBOOK).

## Exact next step

1. Owner: verify stamp duty rates for at least one state (`docs/RUNBOOK.md`), starting with
   the state where most of your agents work; share https://tools.changelense.in with agents.
2. Engineer: add Hindi fields for rule descriptions/surcharge names in the stamp-duty data;
   publish each state as the owner verifies it (remove noindex + add SEO back to Lighthouse
   when the first state goes live); then start **Phase 3** (paid templates + payments).

## Blockers

- **Branch protection on a private repo** needs GitHub Pro/Team, or the repo must be public
  (ADR-009).

## Questions for owner

1. ~~Domain~~ → **answered:** `tools.changelense.in` (ADR-020). Still open: owner name for legal
   pages and a support address on the domain (e.g. `support@changelense.in`).
2. **Profession:** confirm Indian real-estate agents (vs tuition teachers) as the first market.
3. ~~Brand~~ → **answered:** ChangeLens (ADR-019).
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
14. **EMI sources** (new): the known-answer file lists candidate pages per figure because the
    build environment could not open them directly. Please (or the Verifier) open a few and
    confirm; every figure is also recomputed independently, so the maths is not at risk.
15. **TDS on commission** (new): should the commission calculator show TDS? Published sources
    disagree on the current section 194H rate, so it is left out until a CA confirms it.
