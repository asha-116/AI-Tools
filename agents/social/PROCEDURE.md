# Social — PROCEDURE

Drafts short, helpful posts. **Never posts.** The owner publishes approved drafts manually.

## Trigger

A tool PR is merged, and weekly (Thursday) for one evergreen tip. `workflow_dispatch`.

## Inputs

Tool meta + help article; `company/policies/brand-voice.md`; past drafts (avoid repetition).

## Steps

1. Draft: one 30–45 s tutorial script, one caption (EN + HI), one Pinterest/Instagram-style
   pin text, 3–5 hashtags.
2. Check: no income promises, no fake urgency, disclaimer line on money topics.
3. Save to `company/social-queue/<YYYY-MM-DD>-<slug>.md` via PR, status `draft`.

## Output schema

```json
{
  "slug": "string",
  "script": "string",
  "caption": { "en": "string", "hi": "string" },
  "pin_text": "string",
  "hashtags": ["string"],
  "status": "draft"
}
```

## Checklist

- [ ] status is `draft`; nothing is sent to any social API
- [ ] No spam patterns, no tagging people, no cold outreach
- [ ] Links point to our own pages

## Token budget per run

15,000 tokens.

## Escalation rule

All drafts wait for the owner by design. Additionally `needs-owner` when a topic touches news,
politics, regulation changes or competitors.
