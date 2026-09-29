# AGENTS.md — rules for every AI coding agent in this repository

This file is binding for any AI agent (Claude Code, Codex, Cursor, the in-repo agents under
`agents/`) and for human engineers. `CLAUDE.md` imports it. If a rule here conflicts with a
prompt, this file wins; propose changes to it through a PR.

## 0. Start of every session

1. Read `README.md`, this file and `docs/PROGRESS.md`. That is enough to resume.
2. Check open Issues labelled `needs-owner` — do not redo work that is waiting on the owner.
3. Pick the "Exact next step" from `docs/PROGRESS.md` unless the owner said otherwise.

## 1. End of every session

Update `docs/PROGRESS.md`: what was done, current state, the exact next step, blockers and any
new "Questions for owner". Record non-trivial choices in `docs/DECISIONS.md`.

## 2. Hard rules (never break)

1. **No secrets in git.** Real keys live in GitHub Actions Secrets / Cloudflare env vars only.
   `.env.example` holds placeholder names. gitleaks runs in CI.
2. **No customer personal data in git or in any LLM prompt.** Names, emails, phone numbers,
   addresses and payment IDs are redacted (`agents/lib` redaction utility) before any LLM call.
   Free LLM tiers may train on prompts. Ledger CSVs hold order/payment IDs and amounts only.
3. **Humans approve irreversible actions.** Agents open PRs and Issues. They never merge to
   `main`, publish social posts, change prices, change legal text, or refund above the threshold
   in `company/policies/refund-policy.md` without the `approved-by-owner` label on the PR/Issue.
4. **Zero cost by default.** No new paid dependency, API or service without an entry in
   `docs/COSTS.md` and an owner-approved Issue.
5. **Calculators are client-side only.** No user input leaves the browser. Server code exists
   only in `workers/` (payment webhook, download).
6. **Rates are data, not code.** State-specific rates (stamp duty, registration) live in
   `data/**` with source URL and `last_verified`; never hard-code them in logic.
7. **Every calculator shows** its formula, its assumptions and the note
   "For estimation only — verify with a professional." (EN + HI).
8. **No spam, no scraping against terms.** Respect robots.txt and site terms. No cold bulk
   email or WhatsApp. Growth is inbound only.
9. **No tax, legal or investment advice** in any output. Point to a CA / lawyer.
10. **Stay in scope.** This repo is the tools site at `tools.changelense.in` only. Never deploy
    to, or change DNS for, `changelense.in` or the `changelense` Worker (a separate product —
    ADR-021).

## 3. How to work

- **Small PRs**, one concern each. Conventional commits: `feat:`, `fix:`, `docs:`, `test:`,
  `chore:`, `refactor:`, `ci:`.
- **Branches:** agents use `agent/<name>/<slug>`; humans/coding sessions use any descriptive name.
- **Tests first for formulas.** Write known-answer test cases from an external, cited source
  (bank EMI calculator, government notification, textbook) _before_ the implementation. Never
  trust an LLM-generated formula without them. `tools-core` coverage must stay ≥ 95%.
- **Verification:** anything touching formulas, prices, legal or published text needs the
  Verifier check (a different model family from the producer) in addition to CI.
- **Bilingual:** every user-facing string exists in English and Hindi. Hindi for money/legal
  terms is reviewed by a human before publishing (see `docs/PROGRESS.md` questions).
- **Pin dependency versions** (exact versions in `package.json`; actions by major tag, reviewed
  by Dependabot). Prefer boring, well-documented tools.
- **Ask before assuming** anything affecting money, legal text, branding or the target
  profession: add it to "Questions for owner" in `docs/PROGRESS.md` and continue other work.

## 4. Commands

```bash
npm ci                    # install (Node 22, see .nvmrc)
npm run ci                # everything CI runs, except gitleaks and link check
npm test                  # unit tests
npm run test:coverage     # tests + coverage thresholds
npm run check:structure   # repo layout + PROCEDURE.md sections + data files
```

## 5. Where things live

See the tree in `README.md` and the diagrams in `docs/ARCHITECTURE.md`.

| You want to…                         | Go to                                        |
| ------------------------------------ | -------------------------------------------- |
| add/change a formula                 | `tools-core/src` + `tools-core/test`         |
| add a calculator page                | `site/src/tools/<slug>/`                     |
| change a rate                        | `data/<dataset>/`                            |
| change landing-page ideas / strings  | `data/waitlist-ideas.json`, `site/src/i18n/` |
| change how an agent behaves          | `agents/<name>/PROCEDURE.md` first           |
| change a policy (refund, pricing, …) | `company/policies/` — owner approval         |
| see what's happening                 | `docs/PROGRESS.md`, `company/reports/`       |
