# Roadmap

Phases and acceptance criteria. Tick items as they land; each phase ends with a PR titled
`Phase N: <name>` containing a summary, screenshots where relevant, and "How to verify".

## Phase 0 — Foundation

- [x] Repo structure (see `README.md`; deviations in `docs/DECISIONS.md` ADR-014)
- [x] README, AGENTS.md, CLAUDE.md (imports AGENTS.md)
- [x] Docs: ARCHITECTURE, PROGRESS, ROADMAP, DECISIONS, COSTS, RUNBOOK, SETUP
- [x] `.env.example` with placeholder names only
- [x] Licence: proprietary "All rights reserved" (owner may change)
- [x] CI: lint, format, typecheck, unit tests + coverage gate, gitleaks, link check, structure check
- [x] Agent `PROCEDURE.md` for all nine agents
- [x] Issue templates, PR template, label set + sync workflow, CODEOWNERS, Dependabot
- [x] Branch protection instructions in `docs/SETUP.md`
- [ ] **Done when:** CI is green on the Phase 0 PR and the owner confirms SETUP.md is followable

## Phase 1 — Demand test

- [x] Astro site scaffold (EN + HI routing), deploy workflow to Cloudflare Pages
- [x] Landing page with 3 candidate tool ideas and "notify me" buttons per idea
- [x] Waitlist Worker (+ D1) with validation, rate-limit, honeypot; no PII in logs
- [x] Privacy note on the form — **draft**, consent wording needs owner approval (DPDP Act)
- [x] Cloudflare Web Analytics (cookieless) — wired, switched on by the `CF_BEACON_TOKEN` variable
- [ ] **Done when:** page is live on `*.pages.dev` and sign-ups are recorded
      (needs the owner's Cloudflare setup, `docs/SETUP.md` §5)

## Phase 2 — Free calculators

- [ ] EMI calculator
- [ ] Stamp duty + registration by state (data in `data/stamp-duty/`, ≥ 5 states to start)
- [ ] Commission split calculator
- [ ] Each: bilingual, mobile-first, shareable result link (inputs in URL hash), formula +
      assumptions + disclaimer shown
- [ ] `tools-core` coverage ≥ 95%; ≥ 10 known-answer cases per tool, each with a source
- [ ] Lighthouse CI (mobile) ≥ 90 on every tool page; accessibility checks
- [ ] **Done when:** Lighthouse ≥ 90 mobile for all tools and QA + Verifier pass

## Phase 3 — Paid products, payment, delivery

- [ ] 2 paid templates (spec.json, test data, how-to guide), e.g. lead tracker, commission ledger
- [ ] Razorpay Payment Page (test mode)
- [ ] `payment-webhook` Worker: signature check, idempotent, signed download token ≤ 72 h,
      email to buyer
- [ ] `download` Worker: validates token + expiry, streams from R2
- [ ] Tests: valid purchase, duplicate webhook, invalid signature, expired token, tampered token
- [ ] `legal/`: terms, privacy, refund, contact — drafted, labelled `needs-owner`
- [ ] **Done when:** end-to-end purchase works in Razorpay test mode incl. duplicate and invalid-signature tests

## Phase 4 — Agents v1

- [ ] `agents/lib`: LLM client + fallback + budgets, redaction, schema validation, logging, dry-run
- [ ] Orchestrator, Builder, QA, Verifier, Controller — dry-run, then live
- [ ] GitHub App token for agent PRs (so CI runs on them — see ADR-015)
- [ ] **Done when:** one unattended cycle: Orchestrator Issue → Builder PR → QA + Verifier pass →
      owner merges → site deploys → Controller reports

## Phase 5 — Agents v2 (growth + support)

- [ ] Demand Researcher, SEO/Listing, Social (draft-only), Support (redaction + refund threshold)
- [ ] **Done when:** a week of daily reports exists and owner workload per RUNBOOK ≤ 2 h/week

## Phase 6 — Hardening

- [ ] Free-tier usage monitoring, alert at 70% of any limit
- [ ] Auto-Issue on any workflow failure
- [ ] Backup/export script for ledger and memory
- [ ] Monthly cost report
- [ ] **Done when:** `docs/COSTS.md` shows current usage for every service and every alert path is tested
