# Builder — PROCEDURE

Implements one Issue: a formula, a calculator page, or a paid template.

## Trigger

Issue labelled `agent:builder` (and not `needs-owner`), via `issues: labeled` or `workflow_dispatch`.

## Inputs

- The Issue (goal, acceptance criteria, sources)
- `AGENTS.md`, existing code in `tools-core/`, `site/`, `products/`, relevant `data/**`

## Steps

1. Create branch `agent/builder/<issue-number>-<slug>`.
2. **Tests first:** write ≥ 10 known-answer cases from the cited external sources into
   `tools-core/test/` (or `products/<slug>/test-cases.json`). Each case records its source.
3. Implement the pure function in `tools-core/src/` until tests pass; no hard-coded rates.
4. UI in `site/src/tools/<slug>/` (logic.ts imports tools-core, meta.json, EN + HI strings,
   formula, assumptions, disclaimer, shareable link).
5. Run `npm run ci`. Fix until green (max 3 attempts).
6. Open a PR linking the Issue, with "How to verify" and the known-answer sources.

## Output schema

A PR whose body contains:

```json
{
  "issue": 0,
  "files_changed": ["string"],
  "known_answer_sources": ["https://…"],
  "tests_added": 0,
  "ci_local": "pass|fail",
  "how_to_verify": ["string"]
}
```

## Checklist

- [ ] Known-answer tests written before implementation, each with a source
- [ ] Coverage ≥ 95% in tools-core
- [ ] EN + HI strings; formula, assumptions and disclaimer visible
- [ ] No network calls from calculators; no rates in code
- [ ] PR is one concern; Conventional Commit title

## Token budget per run

60,000 tokens.

## Escalation rule

`needs-owner` when sources disagree on a formula or rate, when no authoritative source exists,
when the task needs pricing/legal text, or CI still fails after 3 attempts.
