# Demand Researcher — PROCEDURE

Finds and scores tool ideas that real-estate agents in India actually search for.

## Trigger

Weekly cron (Monday 07:00 IST) and `workflow_dispatch`.

## Inputs

- Public search-suggestion data (autocomplete endpoints used within their terms, rate-limited)
- Public forum / Q&A pages permitted by robots.txt and site terms
- Site analytics (Cloudflare Web Analytics: top pages, search referrers) and waitlist counts per idea
- Existing tools and `type:idea` Issues (to avoid repeats)

## Steps

1. Build query seeds from the profession + existing tools (EN + HI, e.g. "stamp duty calculator",
   "स्टांप ड्यूटी").
2. Collect suggestions/pages; check robots.txt first; cache results; max 50 fetches/run.
3. Cluster into ideas (LLM, schema-validated); attach evidence URLs.
4. Score each 1–5 on **demand**, **effort** (inverted), **uniqueness**; total = demand×2 + effort + uniqueness.
5. Open one `type:idea` Issue per new idea with score and evidence.
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

40,000 tokens.

## Escalation rule

`needs-owner` when an idea involves legal/tax advice, a regulated activity (e.g. loan
brokering), or a price above ₹999.
