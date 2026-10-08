# Goals

Owner-set. The Orchestrator reads this daily. Keep it short: ≤ 5 bullets per horizon.

Done already (do not plan these again): Phases 0–6 are built and merged — landing page with
waitlist, calculators, paid-template delivery (Razorpay, test mode, templates shown as
"upcoming"), and all agents running in dry-run.

## This month (October 2026) — draft, owner to confirm

- Collect ≥ 50 waitlist sign-ups (inbound only) to choose which paid template to sell first.
- Keep every calculator correct: known-answer tests green, `data/**` rates re-verified with
  `last_verified` dates.
- Owner decisions open in `docs/PROGRESS.md` "Questions for owner": prices, legal text, support
  inbox, research sources. Agents wait on these; they do not decide them.
- Switch agents from dry-run to live once the GitHub App exists (`docs/SETUP.md` §3.4, §8).

## This week

- Owner creates the agents' GitHub App, then sets `AGENTS_LIVE=true`.
- Owner opens the template `.xlsx` files in Google Sheets and confirms they work.
