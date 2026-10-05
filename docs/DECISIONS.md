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
- **Status:** Proposed — Phase 4.

### ADR-013 — LLM provider fallback order

- **Decision (initial):** Gemini (Flash) → Groq (Llama) → Cerebras → OpenRouter free models → Ollama (local).
  Verifier picks the first provider whose **model family** differs from the producer's.
- **Status:** Proposed — Phase 4; finalised after measuring quality and free-tier limits.

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
