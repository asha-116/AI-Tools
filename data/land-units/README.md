# Land units

Unit sizes for the land area converter (`site/src/tools/area/`, `tools-core/src/area.ts`).
Rates and sizes are data, never code (AGENTS.md rule 6).

| File            | Status     | What                                                                                |
| --------------- | ---------- | ----------------------------------------------------------------------------------- |
| `standard.json` | `verified` | sq ft, sq yd (gaj), sq m, are, acre, hectare: exact definitions (yard = 0.9144 m)   |
| `guntha.json`   | `verified` | guntha for Maharashtra and Karnataka; owner-checked against RTC / 7/12 (2026-10-09) |
| `regional.json` | `draft`    | cent, ground, marla, kanal: from commercial converter sites, not checked            |

- The live site shows only units from a `verified` file. Draft units appear on the owner-review
  link `/tools/area/#drafts=1`, marked "being verified".
- To verify `guntha.json`, follow its `verification_checklist`. To verify `regional.json`: check each unit against the state's revenue department or land
  records, add those sources, set `"status": "verified"`, put your name in `verified_by` and
  update `last_verified`. Open the PR with the `approved-by-owner` label.
- Bigha, biswa and katha are left out on purpose: their size changes by state and even district.
- Every `sq_m` is checked against `sq_ft × 0.09290304` and against the known answers in
  `tools-core/test/fixtures/area-known-answers.json`. CI fails a `verified` file older than
  180 days (`scripts/check-data-freshness.mjs`).
