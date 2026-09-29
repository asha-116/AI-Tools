# Stamp duty & registration data

One JSON file per state/UT, named `<STATE_CODE>.json` (e.g. `MH.json`), validated against
[`schema.json`](schema.json) and by `scripts/check-structure.mjs` in CI.

Rules (from the project brief, §3.9):

- Rates live **only** here — calculator logic in `tools-core` reads this data and never hard-codes a rate.
- Every file lists at least one official `https://` source and a `last_verified` date.
- A rate change is a `type:data` PR that the Verifier must pass and the owner must approve.
- Anything older than 180 days since `last_verified` is flagged by the Orchestrator for re-verification.

No state files exist yet — they arrive in Phase 2.
