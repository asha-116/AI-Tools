# Owner runbook (target ≤ 2 hours/week)

You are the board. Agents do the work; you approve money, legal text, public claims and
anything irreversible. Everything you need arrives as a GitHub notification.

## Daily (≈ 5 min, optional)

- Skim `company/reports/daily/<today>.md` (linked from the Orchestrator's PR/Issue).
- Anything labelled `type:alert` → read it; most have a suggested fix.

## Weekly (≈ 90 min, one sitting)

1. **Owner queue (30 min)** — Issues labelled `needs-owner`, oldest first. Answer in the
   Issue; add `approved-by-owner` when you approve. Close with a reason when you decline.
2. **PR review (30 min)** — PRs waiting on you. For each: read "How to verify", check CI +
   Verifier are green, then merge or request changes. Never merge red CI.
3. **Money (10 min)** — weekly P&L in `company/reports/weekly/`. Compare Razorpay dashboard
   settlements against the Controller's numbers; mismatches become `type:bug` Issues.
4. **Social (10 min)** — review drafts in `company/social-queue/`; post the ones you approve
   yourself (agents never post).
5. **Goals (10 min)** — edit `company/goals.md` for next week (keep it ≤ 5 bullets).

## Monthly (≈ 30 min)

- `docs/COSTS.md`: any service > 70% of its free tier? Decide: reduce, switch, or pay.
- Re-verify rates older than 180 days when the Orchestrator flags them.
- Read the monthly summary in `company/memory/`.

## Never delegate

- Approving legal pages, prices, refunds above the threshold, public posts.
- Razorpay KYC, bank details, key rotation.
- Tax / GST decisions (talk to a CA).

## Emergency

- **Leaked secret:** rotate it in the provider first, then update GitHub/Cloudflare secrets,
  then open a `type:alert` Issue describing what happened (no secret values in the Issue).
- **Wrong calculator result live:** revert the PR on `main` (GitHub "Revert" button), then
  open a `type:bug` Issue.
- **Agents misbehaving:** disable the workflow (Actions → workflow → "Disable workflow").
