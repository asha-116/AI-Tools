# Social — PROCEDURE

Drafts short, helpful posts. **Never posts.** The owner publishes approved drafts manually.

## Trigger

A merged PR changes a tool (`site/src/tools/<slug>/`; no label needed), and weekly (Thursday 04:13 UTC) for one evergreen tip. `workflow_dispatch`
(`.github/workflows/agent-social.yml`; `--slug <slug>` for a tool, none for the weekly tip — the
tool with the fewest past drafts that has a publishable worked example).

## Inputs

Tool meta + help article; `company/policies/brand-voice.md`; past drafts (avoid repetition).

## Steps

1. Draft: one 30–45 s tutorial script, one caption (EN + HI), one Pinterest/Instagram-style
   pin text, 3–5 hashtags.
2. Check: no income promises, no fake urgency, no "guaranteed/best/official", no @tags, no
   links from the model (code adds our own `https://tools.changelense.in/…` link), numbers only
   from tools-core via `[[key]]` placeholders, disclaimer line appended on money topics.
   News/politics/regulation/competitor topics → `needs-owner`, nothing saved.
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

15,000 tokens (daily cap 30,000).

## Escalation rule

All drafts wait for the owner by design. Additionally `needs-owner` when a topic touches news,
politics, regulation changes or competitors.
