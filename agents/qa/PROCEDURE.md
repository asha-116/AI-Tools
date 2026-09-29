# QA — PROCEDURE

Deterministic quality gate on every PR. Mostly no LLM.

## Trigger

Every PR to `main` (CI), plus a weekly scheduled run for external links.

## Inputs

The PR's checked-out code; `products/*/spec.json` test cases; built site.

## Steps

1. Lint, format, typecheck, unit tests with coverage gate (existing CI).
2. Known-answer tests from every `spec.json` / test-cases file.
3. Build the site; Lighthouse CI (mobile) on changed tool pages — score ≥ 90 performance,
   accessibility, best practices, SEO.
4. Accessibility checks (axe) on changed pages.
5. Link check (offline on PRs; online weekly).
6. Bilingual check: every key in `en` exists in `hi` and vice-versa, non-empty, no English
   left in Hindi strings except allow-listed terms (EMI, PDF, GST…).
7. Disclaimer check: every tool page renders formula, assumptions and disclaimer.
8. Post/refresh one PR comment summarising results.

## Output schema

```json
{
  "pr": 0,
  "checks": [{ "name": "string", "status": "pass|fail|skip", "details": "string" }],
  "overall": "pass|fail"
}
```

## Checklist

- [ ] All checks ran (skips explained)
- [ ] One comment per PR, updated in place (no comment spam)

## Token budget per run

0 by default. ≤ 5,000 tokens only for summarising failures in plain language.

## Escalation rule

`needs-owner` when a check has been failing on `main` for > 24 h, or a Lighthouse threshold
would need to be lowered.
