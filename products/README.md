# products/ — paid templates

One folder per product: `spec.json` (sheets, columns EN + HI, formulas, known-answer cases),
`guide.en.md` / `guide.hi.md` (how-to). `catalog.json` lists what can be bought and which files
each purchase unlocks (prices are placeholders until the owner sets them).

| Piece                     | Where                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| Formula logic + tests     | `tools-core/src/templates.ts`, `tools-core/test/templates.test.ts` |
| Workbook generator        | `scripts/build-templates.mjs` (`npm run build:templates`)          |
| Built files (git-ignored) | `products/<id>/dist/{en,hi}/<id>.xlsx` → uploaded to R2            |
| "Coming soon" pages       | `/templates/<id>/` and `/hi/templates/<id>/`                       |

The generator refuses to build if a formula points at the wrong column or compares against a
label the column does not have.

## Before selling a template (owner, ≈ 10 min per file)

Open the English and the Hindi file in **Google Sheets** (File → Import) and in **Excel 365**:

1. The "Call today" / "आज कॉल करें" sheet lists the example leads that are due today or overdue.
2. Rupee amounts show Indian grouping (1,00,00,000.00); dropdowns work in the list columns.
3. Commission example 1 shows: commission 2,00,000 · GST 36,000 · total 2,36,000 ·
   received 1,18,000 · pending 1,18,000 · "Part paid" · co-broker 1,00,000 · my share 1,00,000.
4. Hindi wording reviewed by a Hindi speaker.

Formulas and dropdowns cover rows 2–1000.
