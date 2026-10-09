# Verifier — PROCEDURE

Independent second opinion using a **different model family** from the one that produced the change.

## Trigger

PRs that touch `tools-core/`, `data/`, `products/`, `legal/`, `company/policies/`,
`site/src/content/`, or any price. Required status check `verifier`.

## Inputs

PR diff; the producer's model family (from PR metadata / agent log); cited sources;
`products/*/spec.json`.

## Steps

1. Pick the first provider in `providers.json` whose model family ≠ producer's. If none is
   available, fail with "no independent verifier" (never self-verify).
2. **Formulas:** sample 10 cases (edge + typical); ask the verifier model to work them out
   independently from the cited formula description (not from our code). The model answers
   each field as an arithmetic expression (numbers, + - * / ^, parentheses, round), which
   `src/expr.ts` evaluates exactly — models choose formulas well but do long arithmetic badly.
   Compare to our function's output within tolerance (₹1 or 0.01%).
3. **Claims/text:** list every factual claim (rates, laws, numbers); check each against the
   cited source text; flag unsupported claims, advice-like language and missing disclaimers.
   A claim with no source, in a file that cites its own sources (e.g. a data file), is
   "unchecked" (check by hand) rather than unsourced; a URL the model invents stays unsourced.
   Statements about this project's own code, tests or CI are not claims; README files are not
   claim-checked. The disclaimer check applies to published content (`site/src/content/`) only.
4. **Prices/legal:** confirm the PR carries `approved-by-owner`; otherwise fail.
5. Set status + post one comment with a table of cases and findings.

## Output schema

```json
{
  "pr": 0,
  "verifier_model_family": "string",
  "producer_model_family": "string",
  "cases": [{ "input": {}, "expected_by_verifier": 0, "actual": 0, "match": true }],
  "claims": [{ "claim": "string", "source": "https://…", "supported": true, "note": "string" }],
  "verdict": "pass|fail",
  "reasons": ["string"]
}
```

## Checklist

- [ ] Verifier model family differs from producer
- [ ] 10 cases for formula changes; every claim checked
- [ ] Pricing/legal changes carry `approved-by-owner`

## Token budget per run

30,000 tokens.

## Escalation rule

`needs-owner` when verifier and implementation disagree after a re-check, or when a source
is ambiguous. Never "fix" the code itself.
