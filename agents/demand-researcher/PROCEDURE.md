# Demand Researcher — PROCEDURE

Finds and scores tool ideas that real-estate agents in India actually search for.

## Trigger

Weekly cron (Monday 01:37 UTC ≈ 07:07 IST, `.github/workflows/agent-demand-researcher.yml`) and
`workflow_dispatch`. Runs only when `vars.AGENTS_ENABLED == 'true'`; dry-run unless `AGENTS_LIVE`.

## Inputs

- Public search-suggestion data from the sources in [`sources.json`](sources.json) — only type
  `autocomplete` exists; every source ships `enabled: false, terms_checked: false` and the agent
  refuses to load a source enabled without `terms_checked: true` (owner reads its terms first)
- Forum / Q&A pages: not implemented (would need a new allow-listed source type + owner approval)
- Waitlist counts per idea from the optional `WAITLIST_COUNTS` env (JSON `{"idea-id": n}`); skipped
  when unset. Site analytics: not wired yet
- Existing tools and `type:idea` Issues (to avoid repeats)

## Steps

1. Build query seeds from the profession + existing tools (EN + HI, e.g. "stamp duty calculator",
   "स्टांप ड्यूटी").
   No source enabled → stop here and report "no sources enabled" + waitlist counts (exit 0).
2. Collect suggestions with `src/fetcher.ts`: allow-listed origins only, robots.txt fetched,
   parsed and cached per origin (unreachable/403/5xx → disallow all), user-agent
   `ChangeLensResearchBot (+https://tools.changelense.in)`, ≥ 2 s between requests per origin,
   back off an origin after HTTP 429, response cache, max 50 requests/run (robots.txt included).
   Usernames/handles and PII are stripped (`sanitize` + `agents/lib` redact) before the LLM.
3. Cluster into ideas (LLM, `schema.ts`); keep only evidence URLs fetched in this run (≥ 2).
4. Score each 1–5 on **demand**, **effort** (inverted), **uniqueness**; total = demand×2 + effort + uniqueness.
5. De-dup against existing tools, waitlist ideas and open `type:idea` Issues (GitHub search).
   Open one `type:idea` Issue per new idea (max 5) with score and evidence.
6. For the top idea: open a follow-up Issue for a landing-page/waitlist test before any build.

## Output schema

```json
{
  "ideas": [
    {
      "title": "string",
      "description": "string",
      "evidence": [{ "url": "https://…", "note": "string" }],
      "scores": { "demand": 1, "effort": 1, "uniqueness": 1 },
      "total": 0,
      "free_or_paid": "free|paid",
      "languages": ["en", "hi"]
    }
  ]
}
```

## Checklist

- [ ] robots.txt respected; no login-walled or ToS-prohibited sources
- [ ] Every idea has ≥ 2 evidence URLs
- [ ] No duplicates of existing tools or ideas
- [ ] No personal data captured from forums (usernames stripped)

## Token budget per run

40,000 tokens (daily cap 60,000).

## Escalation rule

`needs-owner` when an idea involves legal/tax advice, a regulated activity (e.g. loan
brokering), or a price above ₹999.
