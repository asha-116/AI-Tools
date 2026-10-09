# Progress

Living status log. Update at the end of every session (see `AGENTS.md` §1).

## Current phase

**Phases 4–6 built in dry-run (2026-10-06); everything left needs the owner.** All nine agents,
the shared runtime and the Phase 6 hardening exist, are tested and run cleanly without keys —
but nothing runs on a schedule and nothing writes to GitHub until the owner switches it on
(`docs/SETUP.md` §7–8). Phase 3's remaining steps (prices, Razorpay test mode, publishing legal
pages) also wait on the owner. The site is live at **https://tools.changelense.in** with EMI and
commission calculators, stamp duty "coming soon" (until a state is verified) and the two
templates "coming soon".

## Done

- 2026-10-09 — **Agent PRs fixed** (ADR-041): the first live SEO/Social runs (#44–#54) all failed
  CI (formatting, offline link check, three Verifier false alarms). Agents now commit
  Prettier-formatted files, articles carry a Sources list, the link check skips generated
  articles, and the Verifier's disclaimer/advice checks no longer misfire. Next: a page that
  shows the articles on the site (they are not rendered yet).
- 2026-10-09 — **Growth, step 2** (ADR-040): the SEO/Listing and Social agents now know all nine
  tools (worked examples computed by the real calculators) and run for every merged PR that
  changes a tool, without a label. Sitemap merged (asha-116/AI-Tools#42).
- 2026-10-09 — **Growth, step 1** (owner: "an advertisement agent that brings traffic",
  ADR-040): `sitemap.xml` + `robots.txt` pointing to it, optional Search Console tag, owner
  steps in `docs/SETUP.md` §5.5a. Rent vs buy merged (asha-116/AI-Tools#41). Found: the SEO and
  Social agents have never run for the six new tools (label-gated triggers, missing adapters) —
  fixing that is the next PR.
- 2026-10-09 — **Rent vs buy calculator** (owner's pick, ADR-039): `/tools/rent-vs-buy/` and
  `/hi/tools/rent-vs-buy/` — what a buyer and a renter each have after the same years when both
  spend the same each month; numbers only, before tax. Rental yield merged
  (asha-116/AI-Tools#40; Lighthouse job timeout raised to 30 min for the growing page list).
- 2026-10-09 — **Rental yield calculator** (ADR-038): `/tools/rental-yield/` and
  `/hi/tools/rental-yield/` — gross and net yield, collected rent, net income and years of rent;
  before tax, numbers only. Carpet area tool merged (asha-116/AI-Tools#39). Owner chose GitHub's
  built-in auto-merge over a merge agent (no agent merges; the owner enables auto-merge per PR).
- 2026-10-09 — **Carpet area and real price per sq ft** (ADR-037): `/tools/carpet-area/` and
  `/hi/tools/carpet-area/` — super built-up vs RERA carpet area, loading % both ways, common
  area, and the price per sq ft of carpet. Next in the queue: rental yield.
- 2026-10-09 — Home loan eligibility calculator merged (asha-116/AI-Tools#38).
- 2026-10-09 — **Home loan eligibility calculator** (owner: "build other useful tools", ADR-036):
  `/tools/eligibility/` and `/hi/tools/eligibility/` — take-home income (plus co-applicant),
  existing EMIs and the bank's FOIR limit give the largest loan and its EMI; an optional
  property price shows the buyer's own money needed. Next tools in the queue: carpet / built-up
  / super built-up area with price per sq ft, then rental yield.
- 2026-10-09 — **Guntha live** for Maharashtra and Karnataka: owner verified 1 guntha = 1/40 acre
  (1,089 sq ft) against Karnataka RTC and Maharashtra 7/12; `guntha.json` is now `verified`.
- 2026-10-09 — Land units, Maharashtra + Karnataka first (owner's choice): the converter now
  shows ares (Maharashtra 7/12 records area in hectare-are); guntha moved to
  `data/land-units/guntha.json` with a verification checklist — it goes live once the owner
  confirms against an RTC / 7/12 and signs `verified_by`.
- 2026-10-09 — **Home loan prepayment calculator** (asha-116/AI-Tools#28, ADR-035):
  `/tools/prepayment/` and `/hi/tools/prepayment/` — one-time, monthly or yearly extra payments;
  shows interest saved and how much sooner the loan ends (EMI unchanged).
- 2026-10-09 — Verifier fixes from its first live formula run: the model now writes each
  answer as an arithmetic expression the Verifier evaluates exactly (Gemini's own EMI
  arithmetic was wrong by up to ₹4,600); fewer false "unsourced" claims; the area converter is
  registered for independent checks (ADR-030 update).
- 2026-10-09 — **Land area converter** (asha-116/AI-Tools#26, ADR-034): `/tools/area/` and
  `/hi/tools/area/` convert between sq ft, gaj, sq m, acre and hectare. Guntha, cent, ground,
  marla and kanal are in as drafts (owner review link `#drafts=1`) until checked against state
  sources.
- 2026-10-09 — Orchestrator: every Issue now goes to `agent:engineer` (the Builder bounced
  asha-116/AI-Tools#26 and #28 for lack of quoted worked examples), and the prompt lists what
  already exists so it stops re-proposing done work (#27) or inventing paths (ADR-030 update).
- 2026-10-09 — Rate freshness check in CI (asha-116/AI-Tools#21, ADR-033): verified rate files
  older than 180 days fail CI, drafts warn, everything warns 30 days ahead.
- 2026-10-08 — **Agents are live** (`AGENTS_LIVE=true`). First live Orchestrator run opened
  asha-116/AI-Tools#19–#21 and the daily-report PR asha-116/AI-Tools#22; CI ran on it (the App
  token works). The Builder bounced #20 (a config script, not a calculator) back as #23, and #21
  went to QA, which never reads Issues. Fix: Orchestrator Issues go only to `builder`
  (calculator/template) or the new `engineer` label (ADR-030 update).
- 2026-10-08 — Owner created the agents' GitHub App (`AGENT_APP_ID` + key): the token step is
  green and the App can read the repo. That run showed Gemini returning an invalid plan twice,
  which would have opened a `needs-owner` Issue; now another model family gets two tries first
  and the error is logged (ADR-012 update). Next: re-run the Orchestrator, then `AGENTS_LIVE`.
- 2026-10-07 — Third Orchestrator run worked (dry-run): Groq `openai/gpt-oss-120b` planned 5
  tasks. Two fixes: Gemini was overloaded and cost ~4 minutes of retries — now a timeout is not
  retried and a failing provider is skipped for the rest of the run (ADR-013 update); the planned
  tasks were stale because `company/goals.md` still described Phase 0 — rewritten as a **draft
  for the owner to confirm**.
- 2026-10-07 — Owner added `GEMINI_API_KEY` + `GROQ_API_KEY` and `AGENTS_ENABLED=true`. First
  Orchestrator runs: GitHub reads failed (fixed: asha-116/AI-Tools#14), then both AI services
  answered 404 — configured models retired on the free tiers. Fix: model discovery via
  `GET /models` + preference lists (ADR-013 update).
- 2026-10-07 — Phases 4–6 merged (asha-116/AI-Tools#13). Owner ran **Usage report** and
  **Backup** by hand: both green. Backup archived ledger + memory (orders export skipped:
  `ORDERS_D1_ID` not set yet, as expected). Actions use so far this month: 133 of 2,000 billed
  minutes (6.7%; CI 113, Deploy 16) — counted from job timings.
- 2026-10-06 — **Phases 4–6 in dry-run** (this PR; owner asked to split the work across agents
  and finish all phases possible). Built by 8 agents in two waves, merged and checked together:
  - **Wave 1:** `agents/lib` shared runtime (free-LLM client with fallback, budgets, redaction
    with ≥ 60 EN/HI cases, zod validation, scrubbed logs, dry-run-by-default GitHub client with no
    merge method, escalation) — ADR-025; **QA** checks in CI (EN/HI parity everywhere, built
    pages show formula/assumptions/disclaimer, templates show no price, one PR comment) —
    ADR-029; **Controller** core (ledger CSVs with IDs + amounts only, reconciliation to the
    paisa, weekly P&L in IST) — ADR-028; **Phase 6** (monthly usage report with 70% alert,
    Issue on any workflow failure, weekly backups without waitlist emails) — ADR-026/027.
  - **Wave 2:** Orchestrator (daily plan ≤ 5 Issues + report), Builder (tests-first draft PRs),
    Verifier (different model family, `approved-by-owner` gate for price/legal) — ADR-030;
    Support (redact → classify → approved templates only, every refund to the owner) — ADR-031;
    Demand Researcher, SEO/Listing, Social (sources off, numbers from code, drafts only) —
    ADR-032.
  - One reusable workflow `agent-run.yml`: dry-run unless `AGENTS_LIVE=true` **and** the agents'
    GitHub App exist; every agent workflow guarded by `AGENTS_ENABLED=true` (0 minutes until set).
  - Integration fixes found while merging: agents now build from the repo root (the Controller
    shares `workers/lib` code); dry-run escalation no longer crashes without a token; failure
    alerts cover all agent workflows; Support runs every 6 h (not 2 h) to fit the free minutes.
  - Verified: `npm run ci` green — 1,118 tests, coverage 99.65% statements; every agent run
    locally with no keys exits 0 (orchestrator, controller, builder, verifier,
    demand-researcher, seo-listing, social, support).
  - **Not verified:** nothing has run against real GitHub write APIs, LLM providers, Razorpay or
    Cloudflare GraphQL. Provider model names in `agents/lib/src/providers.json` are unverified.
- 2026-10-05 — **Phase 3, part 2: templates, pages, legal drafts** (this PR; built by five
  parallel agents, merged and checked together — owner asked for it):
  - `products/{lead-tracker,commission-ledger}/spec.json`: sheets, columns (EN + HI), Google
    Sheets formulas, hand-checked known answers. Column proposals wait for owner input (Q17).
  - `tools-core/src/templates.ts`: follow-up bucket, call list, lead summary, ledger row and
    totals — exact to the paisa; every spec known answer passes, and ledger commission/GST match
    all 10 published cases in `commission-known-answers.json`. "Open" lead = not won/lost.
  - `scripts/build-templates.mjs` (`npm run build:templates`, exceljs 4.4.0 + jszip 3.10.2,
    both MIT, dev-only): EN and HI .xlsx with a "How to use" sheet, dropdowns, grey formula
    columns, Indian ₹ grouping, example rows. Refuses to build if a formula points at the wrong
    column or compares against a label the column does not have. Built files are git-ignored
    and go to R2 (`products/catalog.json` now lists EN + HI files per product).
    **Not opened in a real spreadsheet app** (LibreOffice in the build environment fails to
    load any file) — owner checklist in `products/README.md`.
  - `/templates/lead-tracker/`, `/templates/commission-ledger/` (+ `/hi/`): "coming soon", what's
    inside (sheets + columns from the spec), no price; "Notify me" opens the waitlist with the
    idea pre-selected (`?idea=`). Home page paid cards link to them. Lighthouse 100 × 4 on all 4.
  - `products/*/guide.{en,hi}.md`: how-to guides.
  - `legal/{terms,privacy,refund,contact}{,.hi}.md`: drafts with placeholders for business
    details and marked proposals; not published (needs owner + lawyer, Q19–Q21).
  - Stamp duty: Hindi rule descriptions and surcharge names in all five draft state files; the
    Hindi page now shows them (structure check requires them).
- 2026-10-05 — **Phase 3, part 1: payment + delivery backbone** (this PR, ADR-023):
  - `workers/payment-webhook` (`toolshop-payments`): verifies the Razorpay signature on the raw
    body, records each payment once in D1 `toolshop-orders` (duplicates and `order.paid` after
    `payment.captured` are no-ops), stores only an HMAC of the buyer's email. `POST /api/claim`
    turns payment ID + email into one signed link per file (≤ 72 h), 10 tries/IP/hour.
  - `workers/download` (`toolshop-download`): verifies the link (403 tampered, 410 expired),
    checks the file belongs to the product, streams it from private R2 `toolshop-products`.
  - `workers/lib`: WebCrypto HMAC (checked against RFC 4231 and node:crypto), tokens, catalog.
  - `products/catalog.json`: lead tracker, commission ledger, bundle with **placeholder prices**
    (not shown anywhere; only sellable in test mode, `ALLOW_DRAFT_PRODUCTS=true`).
  - Landing page: paid ideas now say "Template · coming soon" instead of "small one-time price".
  - `/get-download/` + `/hi/get-download/` (noindex): claim form; links only accepted from the
    download Worker's origin. Shows "not open yet" until `CLAIM_URL` is set.
  - `deploy.yml`: payments and download jobs, skipped until configured (`docs/SETUP.md` §6).
  - Verified locally with both Workers under `wrangler dev`, local D1 + R2 and Chromium: signed
    webhook recorded once, repeat ignored, bad signature 401, claim in EN + HI, wrong email
    "not found", file downloaded, tampered link 403, foreign origin 403, zero off-site requests.
    251 tests; Lighthouse 100/100/100 on the new pages (SEO skipped: noindex).
- 2026-10-05 — **Stamp duty calculator** merged (asha-116/AI-Tools#9) and deployed.
- 2026-09-29 — **Phase 0** merged (asha-116/AI-Tools#1): repo layout, rules, docs, CI,
  templates, labels, agent procedures, policy drafts, stamp-duty schema.
- 2026-09-29 — **Phase 2, part 4: stamp duty calculator** (merged 2026-10-05):
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

- Phase 3 part 1 PR review. Razorpay test-mode setup (`docs/SETUP.md` §6) is **deferred by the
  owner** until business details and prices are ready.
- Owner verification of stamp duty rates (RUNBOOK).

## Exact next step

1. Owner: merge this PR (nothing turns on by merging).
2. Owner, ~30 min, to switch agents on safely (`docs/SETUP.md` §7–8):
   a. add free keys: `GEMINI_API_KEY` + `GROQ_API_KEY` (two families, so the Verifier works);
   b. set `AGENTS_ENABLED=true` and read the next day's Orchestrator run log (artifact);
   c. create the GitHub App (§3.4), then set `AGENTS_LIVE=true`.
3. ~~Owner: run **Usage report** and **Backup** once by hand~~ — done 2026-10-07, both green.
4. Engineer, next: answer the owner's choices below (inbox, research sources, content pages) and
   act on the first live runs' findings; Phase 3 items when prices/legal details arrive.

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
7. ~~Prices~~ → see 18 (deferred).
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
16. ~~Payment provider~~ → **answered 2026-10-05:** Razorpay. Setup deferred until business
    details are ready.
17. **First templates** (new): lead tracker and commission ledger as Google Sheets (delivered
    as .xlsx that opens in Google Sheets / Excel)? Any columns your agents always need?
18. **Prices** (replaces 7): **deferred by owner 2026-10-05** — site shows "coming soon", no price.
    Catalog prices are placeholders until you approve real ones in a PR.
19. **Legal pages** (new): the name (person or business) and contact address to show on terms,
    privacy and refund pages. Razorpay also requires these pages before live mode.
20. **Legal proposals** (new): retention (orders [8] years — ask your CA; support mail [12]
    months), reply within [2] working days, refunds started within [2] working days, template
    licence (own business use, no resale), liability capped at the price paid. See
    `legal/README.md` for the full checklist.
21. **Lawyer review** (new): the legal drafts are not legal advice; have them reviewed before
    publishing. Razorpay needs them live before live mode.
22. **Hindi review** (new, expands 10): new Hindi to review — stamp-duty rule descriptions and
    surcharge names (`data/stamp-duty/*.json`), template pages, the two `guide.hi.md`, the
    Hindi workbooks, and `legal/*.hi.md`.
23. **Agents go-live** (new): create the GitHub App (SETUP §3.4), add at least two free LLM keys
    from different families (e.g. Gemini + Groq), then set `AGENTS_ENABLED=true`, and later
    `AGENTS_LIVE=true`. Please also check the model names in `agents/lib/src/providers.json`.
24. **Support inbox** (new): Cloudflare Email Routing → Worker (recommended, free, mail never
    reaches GitHub) or Gmail API? Until decided, Support stays off.
25. **Research sources** (new): which of the 5 candidates in
    `agents/demand-researcher/sources.json` may we use after you read their terms? All are off.
26. **Help articles** (new): the SEO agent writes Markdown into `site/src/content/articles/`;
    shall we add article pages to the site (needs a small site change + your review per article)?
27. **Verifier risk** (new, ADR-030): it runs PR code while holding the agent keys. OK to accept
    with free-tier keys and a minimal App, or should agent PRs need a human label first?
28. **Razorpay ledger assumptions** (new, ADR-028): confirm with your first test payment that
    Razorpay's `fee` includes GST; settlement checks may raise false alarms around weekends.
29. **Cloudflare token** (new): add "Account Analytics · Read" so the usage report can read
    Cloudflare numbers.
