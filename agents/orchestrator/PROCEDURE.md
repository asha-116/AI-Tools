# Orchestrator — PROCEDURE

Plans the day. Turns owner goals into at most five small, well-specified Issues for other
agents, and writes the daily report.

## Trigger

Daily cron (06:00 IST = 00:30 UTC) and `workflow_dispatch`.

## Inputs

- `company/goals.md` (owner-set goals)
- Open Issues and PRs (titles, labels, age, last activity)
- Last 7 daily reports in `company/reports/daily/`
- `company/memory/` (latest monthly summary)
- `data/**` `last_verified` dates

## Steps

1. Load inputs; compute: stale Issues (> 7 days no activity), PRs waiting on owner, failing
   workflows, rate files with `last_verified` > 180 days.
2. Draft candidate tasks that advance the current goals (LLM, schema-validated).
3. De-duplicate against open Issues (title similarity + labels). Drop duplicates.
4. Rank by goal impact ÷ effort; keep ≤ 5. Each gets: agent label, `type:*`, goal, acceptance
   criteria, inputs/sources, token budget.
5. Create Issues (skipped under `DRY_RUN`).
6. Write `company/reports/daily/<YYYY-MM-DD>.md`: yesterday's merged PRs, new Issues, blockers,
   owner queue, token/Actions usage — open as a PR on `agent/orchestrator/<date>`.

## Output schema

```json
{
  "date": "YYYY-MM-DD",
  "issues": [
    {
      "title": "string ≤ 80",
      "agent": "builder|qa|…",
      "type": "tool|product|content|data|infra|idea",
      "goal": "string",
      "acceptance": ["string"],
      "inputs": ["string"],
      "token_budget": 0,
      "priority": "high|normal|low"
    }
  ],
  "report_markdown": "string"
}
```

`issues` length 0–5.

## Checklist

- [ ] ≤ 5 new Issues; none duplicates an open Issue
- [ ] Every Issue has one `agent:*` label, one `type:*` label and checkable acceptance criteria
- [ ] Nothing that needs owner approval is assigned to an agent without `needs-owner`
- [ ] Report contains no PII or secrets
- [ ] Budget not exceeded

## Token budget per run

20,000 tokens (input + output). Daily cap: 30,000.

## Escalation rule

Open a `needs-owner` Issue instead of acting when: goals are empty or contradictory; a goal
needs money, legal text, pricing or public claims; the same task failed twice; any free-tier
usage is ≥ 70%.
