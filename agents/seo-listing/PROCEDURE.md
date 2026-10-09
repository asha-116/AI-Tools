# SEO/Listing — PROCEDURE

Makes each new tool findable: product page copy, meta tags, schema.org and help articles.

## Trigger

A merged PR that changes `site/src/tools/<slug>/` or `products/<id>/` (`pull_request: closed` +
merged; no label needed), or `workflow_dispatch` (`.github/workflows/agent-seo-listing.yml`). The
slug comes from the PR's changed files or the dispatch input → `--slug <slug>`. Every tool page
has an adapter in `src/tools.ts` (a test fails if one is missing).

## Inputs

The merged tool's `meta.json`, formula, EN + HI strings; `company/policies/brand-voice.md`;
`company/policies/disclaimers.md`; existing articles (to interlink, avoid cannibalisation).

## Steps

1. Draft page title (≤ 60 chars), meta description (≤ 155), H1, intro, FAQ (3–5 Q&A) — EN + HI.
2. Generate `schema.org` JSON-LD (`SoftwareApplication` or `WebApplication`; `FAQPage`;
   `Product` + `Offer` for paid items — price only from approved data).
3. Write 1 EN + 1 HI help article (600–1,000 words): worked example using the tool, formula
   explanation, disclaimer, internal links.
4. Validate JSON-LD, lengths and links; open PR `agent/seo-listing/<slug>` with
   `site/src/content/articles/<slug>.{en,hi}.md` + `<slug>.seo.json` (meta, FAQ, JSON-LD) and
   the producer model family in the body (for the Verifier).

How numbers stay honest: the model writes prose only and may cite example values as `[[key]]`
placeholders; the worked example is computed by the real tools-core function
(`src/tools.ts`), any ₹ / lakh / crore / % figure the model types that the tool did not compute is
rejected, and JSON-LD, links and the disclaimer (`company/policies/disclaimers.md`) are built by
code. No `Offer`/price unless the product is `live` in `products/catalog.json`. Tools without an
adapter in `src/tools.ts`, or whose data is not verified (stamp duty today), escalate instead.
No LLM key → logs the computed example and exits 0 without drafting.

Once merged, the site shows the article at `/guides/<slug>/` and `/hi/guides/<slug>/`
(ADR-042); merging is the owner's approval to publish.

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

40,000 tokens (daily cap 80,000).

## Escalation rule

`needs-owner` for any comparative claim about competitors, any price text, or Hindi legal/financial terms without a reviewed glossary entry.
