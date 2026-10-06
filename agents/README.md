# Agents

Each agent is a **scripted pipeline**, not a persona: a written procedure, a fixed output
schema, a checklist and a token budget. Folder layout (built in Phases 4–5):

```
agents/<name>/
  PROCEDURE.md   the contract — read and change this first
  prompt.md      prompt template(s) used by src/run.ts
  schema.ts      zod schema of the LLM output (mirrors "Output schema" in PROCEDURE.md)
  src/run.ts     the pipeline: exports main() via runAgent(); supports DRY_RUN (default: dry)
  test/          unit tests, run in CI with a mocked LLM and an in-memory GitHub
```

Run one with `npm run agent -- <name>` (compiles `agents/` with `tsc` to `agents/dist/`).

Shared code lives in [`lib/`](lib/README.md).

| Agent                                               | Trigger                                           | Output                            | Phase |
| --------------------------------------------------- | ------------------------------------------------- | --------------------------------- | ----- |
| [Orchestrator](orchestrator/PROCEDURE.md)           | daily cron                                        | ≤ 5 Issues + daily report         | 4     |
| [Demand Researcher](demand-researcher/PROCEDURE.md) | weekly cron                                       | scored idea Issues                | 5     |
| [Builder](builder/PROCEDURE.md)                     | Issue labelled `agent:builder`                    | PR                                | 4     |
| [QA](qa/PROCEDURE.md)                               | every PR                                          | CI status + comment               | 4     |
| [Verifier](verifier/PROCEDURE.md)                   | PRs touching formulas/prices/legal/published text | required status + comment         | 4     |
| [SEO/Listing](seo-listing/PROCEDURE.md)             | tool merged                                       | PR                                | 5     |
| [Social](social/PROCEDURE.md)                       | tool merged                                       | drafts in `company/social-queue/` | 5     |
| [Support](support/PROCEDURE.md)                     | every 2 h                                         | templated replies + log           | 5     |
| [Controller](controller/PROCEDURE.md)               | daily cron                                        | ledger CSVs + P&L                 | 4     |

Common rules for all agents (in addition to `AGENTS.md`):

- Write to the repo only via PRs on `agent/<name>/<slug>`; never push to `main`.
- Validate every LLM output against the schema; invalid → retry once → escalate.
- Stop immediately when the daily token budget is reached; log it; do not switch to a paid model.
- Redact customer text before any LLM call.
- Log to `company/reports/agent-logs/` — no secrets, no PII.
