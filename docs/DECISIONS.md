# Decisions (ADR log)

Each entry: context → decision → alternatives considered → status. Newest last.
Statuses: **Accepted**, **Proposed** (engineer's recommendation, not yet exercised),
**Needs owner** (blocked on an owner decision).

---

### ADR-001 — Monorepo with npm workspaces

- **Context:** site, formulas, workers and agents share TypeScript types and tooling.
- **Decision:** one repo, npm workspaces, Node 22 LTS, exact-pinned dev dependencies.
- **Alternatives:** pnpm (faster, stricter; one more tool to install), Turborepo/Nx (overkill at this size).
- **Status:** Accepted (2026-09-29).

### ADR-002 — TypeScript (strict) + Vitest + ESLint + Prettier

- **Decision:** TS 6.0 strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`;
  Vitest with v8 coverage (≥ 95% gate on `tools-core`); ESLint flat config with
  `typescript-eslint` strict; Prettier.
- **Alternatives:** TS 7 (native compiler) — not yet supported by `typescript-eslint`; Jest — slower,
  more config for ESM; Biome — fewer rules, less documented.
- **Status:** Accepted (2026-09-29).

### ADR-003 — Astro for the storefront

- **Context:** static pages, SEO articles in Markdown, EN + HI routing, interactive calculators.
- **Decision:** Astro static output; calculators as small vanilla-TS islands importing `tools-core`.
- **Alternatives:** plain Vite + vanilla TS (no content collections/i18n routing), Next.js
  (heavier, server features we don't want), Eleventy (weaker TS story).
- **Status:** Accepted (2026-09-29, Phase 1). Astro 7, static output, `i18n` routing (`/` EN, `/hi/` HI).

### ADR-004 — Deploy to Cloudflare Pages from GitHub Actions (direct upload)

- **Decision:** `deploy.yml` builds and runs `wrangler pages deploy` on push to `main`; skipped when secrets are missing.
- **Alternatives:** Cloudflare's Git integration (builds outside our CI, counts against 500 builds/month, less control).
- **Status:** Accepted (2026-09-29, Phase 1). Wrangler pinned to 4.143.0 via `npx`, not a repo dependency, to keep `npm ci` fast.

### ADR-005 — Secret scanning with the gitleaks container

- **Decision:** run `ghcr.io/gitleaks/gitleaks` (pinned tag) over full git history in CI.
- **Alternatives:** `gitleaks-action` (needs a paid licence for organisation-owned repos), GitHub
  secret scanning (free only on public repos).
- **Status:** Accepted (2026-09-29).

### ADR-006 — Link check offline in CI

- **Decision:** `lychee --offline` on Markdown in every PR (repo-internal links and anchors).
  External links are checked on a weekly schedule by QA (Phase 4) so third-party outages never block PRs.
- **Status:** Accepted (2026-09-29).

### ADR-007 — CLAUDE.md imports AGENTS.md

- **Decision:** `CLAUDE.md` contains `@AGENTS.md` (Claude Code import) instead of a symlink or copy.
- **Alternatives:** symlink (breaks on some Windows checkouts), copy (drifts).
- **Status:** Accepted (2026-09-29). Enforced by `scripts/check-structure.mjs`.

### ADR-008 — Proprietary licence by default

- **Decision:** "All rights reserved" `LICENSE`, `"license": "UNLICENSED"` in package.json.
- **Status:** Accepted as default; owner may change.

### ADR-009 — Enforcing "agents never merge" on a private repo

- **Context:** GitHub Free does not offer branch protection / rulesets on **private** repos.
- **Options:** (a) make repo public after confirming no secrets/PII (free protection + unlimited
  standard Actions minutes); (b) GitHub Pro; (c) stay private: agent workflows get no
  `contents: write` on `main`, agents push only to `agent/*` branches, owner merges by convention.
- **Recommendation:** (a). Paid files live in R2, secrets in GitHub/Cloudflare, customer data in
  Razorpay/Cloudflare — nothing in git needs to be private.
- **Status:** Needs owner.

### ADR-010 — Buyer email delivery

- **Context:** Cloudflare has no free general-purpose outbound email; the brief requires emailing the link.
- **Options:** Resend free tier (3,000/month, 100/day, needs a domain); Brevo free (300/day);
  no email — show link on the Razorpay success redirect only.
- **Recommendation:** redirect page shows the link immediately **and** Resend emails it (once a domain exists).
- **Status:** Needs owner. Phase 3 ships **without** email (ADR-023): buyers get links on
  `/get-download/` with the payment ID from Razorpay's own receipt email. Email can be added later
  without changing that flow.

### ADR-011 — Waitlist storage

- **Decision:** Cloudflare Worker + D1 (free: 100k row writes/day) with honeypot + per-IP rate limit.
- **Alternatives:** KV (1,000 writes/day free — enough, but no querying), Google Forms (third-party PII, off-brand).
- **Status:** Accepted (2026-09-29, Phase 1). Duplicates (same email + idea) are ignored; the client IP is
  never stored — only an HMAC of IP + hour, deleted daily by a cron trigger.

### ADR-012 — Schema validation with zod

- **Decision:** zod for LLM output and config validation in `agents/`; JSON Schema files for
  data in `data/` (language-neutral, readable by non-TS tools).
- **Status:** Accepted (2026-10-06): zod 4.6.5, exact-pinned runtime dependency.
- **Update 2026-10-08:** a run where Gemini returned an invalid plan twice would have opened a
  `needs-owner` Issue although Groq was available. Now `chatJson` gives a model of another
  family the same two tries (keeping the caller's exclusions, so the Verifier stays independent)
  and escalates only if that fails too or no other family exists. Each invalid reply is logged
  as `llm.invalid_output` with the validation error (field names, never the reply).

### ADR-013 — LLM provider fallback order

- **Decision (initial):** Gemini (Flash) → Groq (Llama) → Cerebras → OpenRouter free models → Ollama (local).
  Verifier picks the first provider whose **model family** differs from the producer's.
- **Status:** Implemented 2026-10-06 in `agents/lib/src/providers.json`.
- **Update 2026-10-07:** the first live run got HTTP 404 from both Gemini and Groq — the
  configured models had been retired on the free tiers. Instead of guessing again, each provider
  now has a preference list (`model`, `models`) and a `modelPattern`; on a 404 the client asks
  `GET /models` once per run, picks a stable chat model (never previews; OpenRouter only
  `:free`) and logs `llm.model_switched` or `llm.model_unavailable` with a sample of what the
  provider offers. The family is inferred from the model actually used (`familyOf`), so the
  Verifier's "different family" rule holds after a switch. Groq's free tier now serves
  `openai/gpt-oss-*` (family `gpt`), so Gemini + Groq still give two independent families.
- **Update 2026-10-07 (circuit breaker):** the next run spent ~4 minutes on Gemini — four
  "503 busy" answers, then four 60-second timeouts — before Groq answered. Now a timeout is never
  retried, and a provider that times out, stays busy (429/5xx) after its retries or refuses the
  key (401/403) is skipped for the rest of that run (`llm.provider_down`). A 400 or malformed
  answer does not trip it, since those can depend on the request.

### ADR-014 — Additions to the prescribed repo structure

- `scripts/` — repo tooling (`check-structure.mjs`; later backups).
- `tools-core/test/` — tests live beside `src/`.
- `data/stamp-duty/schema.json`, `data/stamp-duty/README.md`.
- `company/social-queue/` — Social agent drafts (named in the brief's agent table).
- `company/reports/{daily,weekly,agent-logs}/` — report subfolders named in the brief.
- `.github/labels.json`, `.github/workflows/labels.yml`, `.github/CODEOWNERS`,
  `.github/dependabot.yml`, `.gitleaks.toml`, `.nvmrc`, `.editorconfig`, Prettier/ESLint/Vitest configs.
- **Status:** Accepted (2026-09-29).

### ADR-015 — Agent PRs must be opened with a GitHub App token

- **Context:** PRs and pushes made with the workflow's built-in `GITHUB_TOKEN` do **not** trigger
  other workflows, so CI/QA/Verifier would never run on agent PRs.
- **Decision:** owner creates a free, repo-scoped GitHub App; agent workflows mint a short-lived
  token with `actions/create-github-app-token`. The App gets `contents`, `pull_requests`,
  `issues` write — but, per ADR-009, cannot bypass protection on `main`.
- **Alternatives:** a fine-grained PAT (tied to the owner's personal account, long-lived).
- **Status:** Proposed — Phase 4.

### ADR-016 — Waitlist as a third Worker (`workers/waitlist/`)

- **Context:** the brief lists only `payment-webhook` and `download` Workers, but Phase 1 needs
  somewhere to record sign-ups.
- **Decision:** a separate `toolshop-waitlist` Worker on `*.workers.dev`, called cross-origin from
  the site with a CORS allow-list (`SITE_ORIGINS`). Handler logic is pure and unit-tested; SQL is
  tested against real SQLite (`node:sqlite`) using the same migration file D1 runs.
- **Alternatives:** Cloudflare Pages Functions (same origin, but server code would live under
  `site/`, against AGENTS.md rule 5); a third-party form service (customer PII leaves our control).
- **Status:** Accepted (2026-09-29).

### ADR-017 — Strict CSP, no inline scripts

- **Decision:** `site/public/_headers` sets a CSP allowing scripts only from `'self'` and
  Cloudflare Web Analytics; Astro is configured never to inline scripts
  (`vite.build.assetsInlineLimit: 0`). Styles allow `'unsafe-inline'` (Astro scoped styles).
- **Status:** Accepted (2026-09-29).

### ADR-018 — Landing-page candidate ideas

- **Decision:** the three ideas shown are stamp duty & registration calculator (free), lead &
  site-visit tracker (paid template) and commission ledger & split calculator (paid template),
  stored in `data/waitlist-ideas.json`. No prices are shown until the owner approves them.
- **Status:** Accepted as a draft; owner may change the ideas or wording before launch.

### ADR-019 — Brand name: ChangeLens

- **Decision (owner, 2026-09-29):** the public brand is **ChangeLens** (replaces the placeholder
  “ToolShop”). Only user-facing text changed (`site/src/config.ts`, README, docs, favicon).
- Internal identifiers stay as they are to avoid breaking deploys: npm package names
  (`toolshop`, `@toolshop/*`), Pages project `toolshop`, Worker `toolshop-waitlist`,
  D1 database `toolshop-waitlist`.
- Note: the domain is spelled `changelense.in` (with an “e”); the brand is “ChangeLens”.
- **Status:** Accepted.

### ADR-020 — Public address: `tools.changelense.in`

- **Context:** `toolshop.pages.dev` was already taken by an unrelated (gambling) site;
  Cloudflare assigned `toolshop-elu.pages.dev`. The owner already has `changelense.in` on
  Cloudflare, served by the existing `changelense` Worker.
- **Decision:** serve the tools site at `tools.changelense.in` (Pages custom domain), leaving
  `changelense.in` untouched for now.
- **Status:** Accepted (live 2026-09-29).

### ADR-021 — Keep the tools site separate from the Change Lens product

- **Context:** the owner's existing product Change Lens (document / PDF / image comparison
  SaaS with accounts, Dodo Payments, Workers AI, D1 `changelense-saas`, R2 `changelense-memory`)
  runs as the `changelense` Worker on `changelense.in`. Merging it into this repo was considered
  (v1.1 and v3.4.2 source reviewed on 2026-09-29).
- **Decision (owner, 2026-09-29):** do **not** merge. This repo is only the tools site at
  `tools.changelense.in`. The `changelense` Worker, its D1 database and R2 bucket are out of
  scope — agents must never deploy to them or change their DNS records.
- **Alternatives:** one repo with two apps; full rewrite into Astro. Both rejected for now.
- **Status:** Accepted.

### ADR-022 — Stamp duty rates: draft until verified by a human

- **Context:** stamp duty rules differ by state, area, buyer and value, change often, and
  published secondary sources disagree (e.g. Tamil Nadu registration 2% vs 4%, Karnataka 1% vs
  2%). Official state portals could not be opened from the build environment.
- **Decision:** each `data/stamp-duty/<STATE>.json` has `status: draft | verified`, an
  `official_source`, and a `conflicts` list. The live page shows **only verified states**; while
  none are verified it shows “coming soon” and is `noindex`. Adding `#drafts` to the URL shows
  drafts under a red NOT-VERIFIED banner for owner review. CI refuses `verified` while
  `conflicts` remain or `verified_by` does not name a person.
- **Alternatives:** publish with a disclaimer only (rejected: wrong tax numbers harm agents'
  credibility); hard-code rates (forbidden by AGENTS.md rule 6).
- **Status:** Accepted.

### ADR-023 — Delivery without our own email: claim page + stateless signed links

- **Context:** Phase 3 needs paid files delivered automatically. Emailing links needs a provider
  decision (ADR-010, still open) and would store or pass buyer emails through another service.
  Razorpay already emails every buyer a receipt with the payment ID. Razorpay's docs could not be
  opened from the build environment, so the webhook format comes from search summaries of them.
- **Decision:**
  - `workers/payment-webhook` (`toolshop-payments`) verifies `X-Razorpay-Signature` (hex
    HMAC-SHA256 of the raw body with the webhook secret) **before** parsing, handles
    `payment.captured` and `order.paid`, and inserts one row per payment ID (`ON CONFLICT DO
NOTHING`), so duplicates and both events for one payment are harmless. It stores IDs, product,
    amount and an **HMAC of the email** — never the email, name or phone.
  - The product is the `product` note if the Payment Page sends one, otherwise the catalog product
    whose price equals the amount; the amount must always equal the full price. Prices of sellable
    products must therefore differ (enforced when the catalog loads). Unmatched payments are kept
    with no product and the buyer is told to contact support.
  - Buyers claim on `/get-download/` with payment ID + email (same "not found" for unknown payment
    and wrong email; 10 tries per IP per hour). The Worker returns one link per file.
  - Links are stateless tokens `payload.HMAC` (separate secret), ≤ 72 h, checked by
    `workers/download` (`toolshop-download`), which streams from a private R2 bucket. Expired →
    410, anything else wrong → 403. Buyers can always claim fresh links.
  - `products/catalog.json` holds prices with `status: draft | live | retired`. Drafts sell only
    when `ALLOW_DRAFT_PRODUCTS=true` (Razorpay test mode). Retired products stay downloadable.
- **Alternatives:** email via Resend (needs ADR-010); Razorpay redirect parameters to show links
  instantly (format not verifiable from here; can be added later); one Worker for both (rejected:
  the download Worker needs no database and its secret surface stays tiny); KV for idempotency
  (D1 already used, 1k KV writes/day limit).
- **Status:** Accepted for test mode; the payload format must be confirmed by the owner's test
  purchase (`docs/SETUP.md` §6.5) before going live. Owner, 2026-10-05: provider stays
  Razorpay; setup and prices deferred, site shows templates as "coming soon".

### ADR-024 — Templates are generated from a spec, with the logic mirrored in code

- **Context:** paid templates are spreadsheets; spreadsheet formulas are easy to get subtly wrong
  (a formula pointing at the wrong column was caught during review of the first draft) and cannot
  be unit-tested directly here.
- **Decision:** each template is a `products/<id>/spec.json` (sheets, columns EN + HI, formulas,
  known answers). `scripts/build-templates.mjs` (exceljs, dev-only) generates EN and HI .xlsx and
  refuses to build when a formula's column letters or compared labels don't match the spec.
  `tools-core/src/templates.ts` implements every derived column; its tests run the spec's known
  answers and the published commission examples. Built files are not committed; they go to R2.
  Google-Sheets-only syntax is translated for Excel (`B2:B` → `B2:B1000`, `{…}` → `HSTACK`).
- **Alternatives:** hand-made Google Sheets (no review trail, drift); a JS spreadsheet engine
  to evaluate formulas in CI (GPL/commercial licences or abandoned projects).
- **Status:** Accepted. Owner opens the files in Google Sheets / Excel before the first sale.

### ADR-025 — Agent runtime: compiled TypeScript, one reusable workflow, dry-run by default

- **Context:** Phase 4 agents share an LLM client, budgets, redaction, logging and GitHub access,
  and must be safe to switch on gradually.
- **Decision:**
  - `agents/lib` is the only runtime. Agents are compiled with `tsc -p agents/tsconfig.json`
    (root `..`, so shared code in `workers/lib` compiles too) to `agents/dist` and run as
    `npm run agent -- <name>`; each `agents/<name>/src/run.ts` exports `main()`. No `tsx`.
  - LLM: OpenAI-compatible free providers in order, retry with backoff + jitter on 429/5xx,
    fall through on failure, `excludeFamily` for the Verifier. Budgets `{perRun, daily}` are
    enforced inside the client; a budget stop or escalation exits 0, only crashes exit 1.
  - The LLM client does **not** redact automatically: any agent that handles customer text
    (Support) must call `redact` first; tests assert it.
  - GitHub writes are no-ops unless `DRY_RUN` is exactly `false`; PR branches must be
    `agent/<agent>/<slug>`; there is no merge method. One commit per PR via the git data API.
  - `.github/workflows/agent-run.yml` (reusable) sets `DRY_RUN=false` only when the variable
    `AGENTS_LIVE=true` **and** a GitHub App token exists (ADR-015); every caller's job is guarded
    by `AGENTS_ENABLED=true`, so nothing costs Actions minutes until the owner switches it on.
    Run logs are kept as 30-day artifacts.
- **Alternatives:** `tsx` at runtime (new dependency); one workflow per agent with copied steps
  (drift in safety switches).
- **Status:** Accepted (2026-10-06).

### ADR-026 — Free-tier monitoring and failure alerts without paid tools

- **Decision:** a monthly `usage.yml` computes Actions minutes from job timings (each job rounded
  up, like billing — the billing API needs an owner token), Cloudflare usage from the GraphQL
  Analytics API (daily limits compared with the busiest day) and LLM tokens from agent logs,
  against limits kept as data in `data/free-tier-limits.json`. At ≥ 70% it opens one
  `needs-owner` Issue (deduped by a hidden marker). `failure-alert.yml` opens one Issue per
  failing workflow on `main` or schedules (PR failures stay on the PR).
- **Status:** Accepted (2026-10-06). Cloudflare GraphQL field names are unverified until the
  first real run.

### ADR-027 — Backups as 90-day workflow artifacts; waitlist excluded

- **Decision:** weekly `backup.yml` exports D1 `toolshop-orders` (whitelisted columns; aborts if
  any value looks like an email) and tars `company/ledger` + `company/memory`, with SHA-256
  manifest, as a 90-day artifact. The waitlist (emails) is never exported by automation — only
  by the owner, to their own device (RUNBOOK).
- **Alternatives:** committing backups to git (history can't be deleted; rejected).
- **Status:** Accepted (2026-10-06). If the repo becomes public, artifacts are visible to
  signed-in users; they hold IDs, amounts and email HMACs only.

### ADR-028 — Controller: deterministic ledger in IST business days

- **Decision:** the Controller is pure arithmetic in integer paise (no LLM). Business day = IST
  calendar day; weekly P&L per ISO week in `company/reports/weekly/`. Ledger CSVs hold IDs and
  amounts only and every write passes a PII guard. Only the `product` note of a payment is kept;
  all other notes are dropped (Payment Page fields can carry buyer data).
- **Assumptions to confirm with a Razorpay test payment:** `fee` includes GST and `tax` is the
  GST part; list endpoints use `from`/`to`/`count`/`skip`; settlement check uses a fixed 2-day lag
  (weekends/holidays will cause false alarms until Razorpay's settlement recon API is used).
- **Status:** Accepted for dry-run (2026-10-06).

### ADR-029 — QA checks are tests, not a separate service

- **Decision:** the QA agent's deterministic checks run as vitest tests in CI: EN/HI parity
  everywhere (strings, specs, data `_hi` fields; Latin words in Hindi only from
  `agents/qa/allowed-latin.json`, changed by PR), built tool pages show formula, assumptions and
  disclaimer, template pages show no price and a "coming soon" badge. One PR comment
  (`<!-- agent:qa -->`) is updated in place by a job with its own minimal permissions; it never
  fails a PR. Online link checks run weekly once agents are enabled.
- **Status:** Accepted (2026-10-06).

### ADR-030 — Builder does only the tests-first half; Verifier is independent and label-gated

- **Context:** free-tier models cannot be trusted to write production formula code, and the
  Verifier must never check its own family's work (AGENTS.md).
- **Decision:**
  - The **Builder** turns an `agent:builder` Issue into a draft PR with a known-answer fixture
    (every case must cite a URL that appears in the Issue), a test skeleton and a PLAN.md. A
    person or coding session implements the function until CI is green. It escalates instead of
    building for pricing/legal Issues, uncited Issues or disagreeing sources.
  - The **Verifier** runs on PRs touching formulas, data, products, legal, policies or content.
    Formula cases (≤ 10, seeded from the PR number) are computed by a model of a **different
    family** from the formula description only, then compared with our function within ₹1 or
    0.01%. Changes to `legal/`, `company/policies/` or any price fail without the
    `approved-by-owner` label (no model involved). No independent provider → failure, never
    self-verification.
- **Known risk:** the Verifier executes the PR's code in a job that holds the agents' App token
  and model keys. Fork PRs are excluded, but a same-repo PR (including one opened by an agent)
  could change what runs. Mitigation before `AGENTS_LIVE=true`: keep model keys low-privilege
  free-tier keys, keep the App's permissions minimal, and review agent PRs before they get the
  `labeled` trigger.
- **Status:** Accepted for dry-run (2026-10-06).
- **Update 2026-10-08:** the first live Orchestrator run gave the Builder a non-calculator task
  (a config script), so the Builder escalated it back to the owner ("no worked examples"), and
  gave QA a task QA never reads. Orchestrator Issues now go only to `builder` (type `tool` or
  `product`) or `engineer` (a human or coding session); other types are re-assigned in code,
  and the prompt says which agents already run on their own schedule.
- **Update 2026-10-09:** the next run gave the Builder two real calculator Issues with source
  URLs, and the Builder bounced both: it needs worked examples **quoted in the Issue**, and the
  Orchestrator cannot fetch pages. It also re-proposed the existing Hindi waitlist form and
  invented `public/` and `tests/` paths. Now every Orchestrator Issue goes to `agent:engineer`,
  who quotes the examples and re-labels it `agent:builder`; the prompt gets a generated
  "what already exists" list (calculators, templates, real paths).

### ADR-031 — Support: templates only, every refund to the owner, no inbox yet

- **Decision:** the Support agent redacts every message (and strips links, which may carry
  download tokens) before any model call, classifies it (keyword fallback without a model),
  and replies only with owner-approved templates from `company/knowledge-base/` (EN + HI; all
  `draft` until a human approves them). Refund threshold stays ₹0: every refund request becomes
  a `needs-owner` Issue with a masked payment ID. Legal threats, chargebacks and unclear
  messages go to the owner. Logs hold a hashed message ref, category and outcome — never text.
  It runs every 6 hours, only when `SUPPORT_INBOX` is set.
- **Open:** the inbox. Recommended: Cloudflare Email Routing → Worker → D1 queue (free, raw mail
  never reaches GitHub); alternative: Gmail API via OAuth.
- **Status:** Accepted for dry-run (2026-10-06).

### ADR-032 — Growth agents: research off by default, numbers from code, drafts only

- **Decision:**
  - **Demand Researcher** fetches only allow-listed sources whose `terms_checked` the owner has
    set in `agents/demand-researcher/sources.json` (all off today), honours robots.txt, max 50
    fetches/run, strips usernames and redacts before any model call. Scores are computed in
    code; an idea needs ≥ 2 fetched evidence URLs.
  - **SEO/Listing** lets the model write prose only; every number in a worked example comes from
    the real tools-core function (unknown figures are rejected), JSON-LD and disclaimers are
    built in code, and no `Offer`/price appears until a product is `live`. Stamp-duty content
    waits for a verified state.
  - **Social** writes drafts to `company/social-queue/` via PR and never calls a social API
    (tested). News, politics, regulation and competitor topics go to the owner.
- **Open:** wiring `site/src/content/articles/` into pages (no content collection yet).
- **Status:** Accepted for dry-run (2026-10-06).

### ADR-033 — Rate freshness is enforced in CI

- **Context:** rate files carried a `last_verified` date, but nothing failed when it got old;
  the Orchestrator only opened a re-verify Issue (asha-116/AI-Tools#21).
- **Decision:** `scripts/check-data-freshness.mjs` runs inside `npm run check:structure` on
  every PR and push. Malformed or future dates fail. A file the site serves as
  `"status": "verified"` fails once its oldest `last_verified` is more than 180 days old; drafts
  only warn. Everything warns 30 days before the limit (GitHub annotations in CI).
- **Trade-off:** when a verified file expires, every PR goes red until it is re-verified or set
  to draft. That is intended: the alternative is the site showing stale rates as verified.
- **Status:** Accepted (2026-10-09). Written in Node like the other repo checks, not the Python
  test the Issue suggested (the repo has no Python toolchain).
