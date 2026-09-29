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
- **Status:** Needs owner (requires domain decision).

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
