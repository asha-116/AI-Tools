# SEO/Listing — PROCEDURE

Makes each new tool findable: product page copy, meta tags, schema.org and help articles.

## Trigger

A PR labelled `type:tool` or `type:product` is merged (`pull_request: closed` + merged), or `workflow_dispatch`.

## Inputs

The merged tool's `meta.json`, formula, EN + HI strings; `company/policies/brand-voice.md`;
`company/policies/disclaimers.md`; existing articles (to interlink, avoid cannibalisation).

## Steps

1. Draft page title (≤ 60 chars), meta description (≤ 155), H1, intro, FAQ (3–5 Q&A) — EN + HI.
2. Generate `schema.org` JSON-LD (`SoftwareApplication` or `WebApplication`; `FAQPage`;
   `Product` + `Offer` for paid items — price only from approved data).
3. Write 1 EN + 1 HI help article (600–1,000 words): worked example using the tool, formula
   explanation, disclaimer, internal links.
4. Validate JSON-LD, lengths and links; open PR `agent/seo-listing/<slug>`.

## Output schema

```json
{
  "slug": "string",
  "meta": {
    "en": { "title": "string", "description": "string" },
    "hi": { "title": "string", "description": "string" }
  },
  "faq": { "en": [{ "q": "string", "a": "string" }], "hi": [{ "q": "string", "a": "string" }] },
  "jsonld": {},
  "articles": { "en": "markdown", "hi": "markdown" }
}
```

## Checklist

- [ ] No claims beyond what the tool does; no "guaranteed", "best", "official" wording
- [ ] Disclaimer present; no tax/legal advice
- [ ] Worked example numbers match the tool's actual output (tested)
- [ ] Verifier required (published text)

## Token budget per run

40,000 tokens.

## Escalation rule

`needs-owner` for any comparative claim about competitors, any price text, or Hindi legal/financial terms without a reviewed glossary entry.
