# site/ — storefront

Static Astro site (ADR-003), deployed to Cloudflare Pages. Scaffolded in Phase 1.

- `src/tools/<slug>/` — one folder per calculator: `logic.ts` (imports `@toolshop/tools-core`),
  UI, tests, `meta.json`
- `src/content/{en,hi}/` — SEO articles (Markdown)
- `public/` — static assets
