# site/ — storefront

Static Astro site (ADR-003), deployed to Cloudflare Pages by `.github/workflows/deploy.yml`.

- `/` English, `/hi/` Hindi. All strings in `src/i18n/strings.ts` (typed so both languages
  have the same keys; `test/strings.test.ts` checks they are non-empty and Hindi is Devanagari).
- Candidate ideas come from `data/waitlist-ideas.json` (shared with the waitlist Worker).
- `src/scripts/` — the only client JS; no inline scripts (CSP, ADR-017).

- `src/tools/<slug>/` — one folder per calculator: `logic.ts` (imports `@toolshop/tools-core`),
  UI, tests, `meta.json`
- `src/content/{en,hi}/` — SEO articles (Markdown)
- `public/` — static assets
