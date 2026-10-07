# agents/lib — shared agent runtime

Small, typed runtime every agent builds on. Import from `agents/lib/src/index.js` (tests also
import `agents/lib/src/testing.js`). Runtime dependency: `zod` only.

## Modules

| Module           | What it gives you                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.ts`         | `runAgent(name, budget, fn, options?)`: wires everything below, turns `Escalation` into an Issue, stops on `BudgetExceeded`, always logs `run.end`    |
| `llm.ts`         | `createLlm()`: OpenAI-compatible chat client, provider fallback, retry 429/5xx with backoff + jitter, `excludeFamily`, `jsonMode`. Never logs prompts |
| `providers.json` | free-tier providers in fallback order (ADR-013): base URL, key env var, model, model `family`, limits. Providers without a key are skipped            |
| `budget.ts`      | `Budget`: per-run and daily token limits; `charge()` throws `BudgetExceeded`. Never switches to a paid model                                          |
| `redact.ts`      | `redact(text, { names? })` → `{ text, map, counts }`; `restore(text, map)`; `containsPii(text)`                                                       |
| `schema.ts`      | `chatJson(llm, req, schema)` and `validateWithRetry(call, schema)`: zod-validate → retry once with the error → throw `Escalation`                     |
| `log.ts`         | JSON-lines logger → `company/reports/agent-logs/<agent>/<YYYY-MM-DD>.jsonl` (UTC); scrubs secrets and PII from every string                           |
| `github.ts`      | `GitHub`: list/search Issues & PRs, read files, create Issue, upsert one marked comment, add labels, open PR, set commit status. Dry-run by default   |
| `escalate.ts`    | `escalate(gh, agent, request)`: one `needs-owner` Issue per key (deduped by a hidden marker); later calls refresh a comment instead                   |
| `prompt.ts`      | `readAgentFile()`, `renderTemplate('{{x}}', vars)` (strict), `promptSections(md)` (split `## system` / `## user`)                                     |
| `config.ts`      | `loadConfig(env)`, `isDryRun(env)` — dry-run unless `DRY_RUN` is exactly `false`                                                                      |
| `errors.ts`      | `BudgetExceeded`, `Escalation`, `LlmUnavailable`, `GitHubError`                                                                                       |
| `testing.ts`     | `fakeLlm`, `fakeFetch`, `jsonResponse`, `completion`, `MemoryGitHub`, `memoryLogger`, `testRunOptions`, `testContext` (tests only, not built)         |
| `cli.ts`         | `npm run agent -- <name>` loader                                                                                                                      |

## Safety rails built in

- **Dry-run is the default.** Every GitHub write (`createIssue`, `upsertComment`, `addLabels`,
  `openPullRequest`, `setCommitStatus`) is a logged no-op returning `{ dryRun: true, number: 0 }`
  unless `DRY_RUN=false`. Reads still happen.
- **No merge, no `main`.** There is no merge method. `openPullRequest` only writes to
  `agent/<agent>/<slug>` (checked even in dry-run) and makes one commit via the git data API.
- **Budgets are enforced inside the LLM client** (checked before, charged after each call), so an
  agent cannot forget. The daily total is read back from today's log (`run.end.tokens`).
- **Logs never contain prompts, replies or keys.** Fields named `prompt`, `messages`, `token`,
  `authorization`… are dropped; strings are scrubbed of key patterns (`sk-`, `gsk_`, `csk-`,
  `AIza…`, `ghp_`, `Bearer …`), known secret env values, and PII (via `redact`).
- **Redaction is the caller's job before any LLM call with customer text** (Support):
  `const { text, map } = redact(raw, { names })` → send `text` → `restore(reply, map)` locally.
  The map holds real PII: memory only, never log or commit it.
- **Never verify with the producer's family:** `llm.chat({ …, excludeFamily: producerFamily })`.
  `run.end` logs `families` (the producer family for the Verifier to read).

## Folder layout per agent

```
agents/<name>/
  PROCEDURE.md   the contract — change this first
  prompt.md      `## system` / `## user` sections with {{slots}}; read with ctx.readFile('prompt.md')
  schema.ts      zod schema(s) of the LLM output (mirrors PROCEDURE.md "Output schema")
  src/run.ts     exports `main()` (calls runAgent) and the pure core function
  test/          vitest; mocked LLM + in-memory GitHub; no network
```

## Writing `src/run.ts`

```ts
import {
  chatJson,
  promptSections,
  renderTemplate,
  runAgent,
  type AgentContext,
  type RunOptions,
} from '../../lib/src/index.js';
import { PlanSchema } from '../schema.js';

/** The logic. Takes ctx so tests can pass testContext(). */
export async function plan(ctx: AgentContext) {
  const p = promptSections(ctx.readFile('prompt.md'));
  const goals = (await ctx.github.getFile('company/goals.md')) ?? '';
  const { data, response } = await chatJson(
    ctx.llm,
    {
      messages: [
        { role: 'system', content: p.system ?? '' },
        { role: 'user', content: renderTemplate(p.user ?? '', { goals }) },
      ],
    },
    PlanSchema,
    'orchestrator plan',
  );
  for (const issue of data.issues) {
    await ctx.github.createIssue({
      title: issue.title,
      body: '…',
      labels: [`agent:${issue.agent}`],
    });
  }
  ctx.log.info('plan.done', { issues: data.issues.length, family: response.family });
  return data;
}

/** Entry point for `npm run agent -- orchestrator`. Budget from PROCEDURE.md. */
export function main(options?: RunOptions) {
  return runAgent('orchestrator', { perRun: 20_000, daily: 30_000 }, plan, options);
}
```

- Throw `new Escalation({ title, context, options, recommendation, key? })` to stop and ask the
  owner; `runAgent` files the deduplicated `needs-owner` Issue. Use `await ctx.escalate(…)` to
  file one and keep going.
- Don't catch `BudgetExceeded` or `Escalation`.
- `runAgent` returns `{ status: 'ok' | 'budget_exceeded' | 'escalated' | 'error', result?, tokens }`.
  Only `error` makes the process exit 1.

## Running an agent

Agents are compiled with `tsc` (no extra runtime dependency): `agents/tsconfig.json` emits
`agents/dist/` (git-ignored).

```bash
npm run build:agents              # tsc -p agents/tsconfig.json
npm run agent -- orchestrator     # build, then node agents/dist/agents/lib/bin/agent.js orchestrator
DRY_RUN=false npm run agent -- orchestrator   # real writes (Actions only, with an App token)
```

The CLI loads `agents/dist/<name>/src/run.js` and calls its `main()`. Environment:
`DRY_RUN`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY` (falls back to `asha-116/AI-Tools`),
`GITHUB_WORKSPACE`/cwd (repo root for logs and prompts), `GITHUB_RUN_ID` (added to log lines and
Issue links), and the provider keys in `.env.example`. In Actions, a workflow step is:

```yaml
- run: npm ci && npm run agent -- orchestrator
  env:
    DRY_RUN: 'false'
    GITHUB_TOKEN: ${{ steps.app-token.outputs.token }} # ADR-015
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
    GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
```

## Testing an agent

```ts
import { describe, expect, it } from 'vitest';
import { fakeLlm, MemoryGitHub, testContext, testRunOptions } from '../../lib/src/testing.js';
import { main, plan } from '../src/run.js';

it('creates Issues from the plan', async () => {
  const github = new MemoryGitHub({ agent: 'orchestrator', files: { 'company/goals.md': '…' } });
  const llm = fakeLlm(['{"date":"2026-10-06","issues":[],"report_markdown":"…"}']);
  await plan(testContext('orchestrator', { llm, github }));
  expect(github.writes).toEqual([]);
  expect(llm.requests[0]?.messages[1]?.content).toContain('…');
});

it('escalates after two invalid replies', async () => {
  const github = new MemoryGitHub({ agent: 'orchestrator' });
  const r = await main(testRunOptions('orchestrator', { llm: fakeLlm(['{}', '{}']), github }));
  expect(r.status).toBe('escalated');
  expect(github.issues[0]?.labels).toContain('needs-owner');
});
```

- `fakeLlm(replies, { family? })`: replies are strings, `{ text, family?, usage? }` or `Error`s,
  returned in order; an empty queue throws. `llm.requests` records what was sent.
- `MemoryGitHub`: seed `issues`, `pulls`, `files`; inspect `writes`, `issues`, `pulls`, `comments`.
- `fakeFetch(handler)` + `jsonResponse()` + `completion(text)` test the real `GitHub`/`createLlm`.
- `memoryLogger()` keeps parsed log lines in `.lines`.
- `agents/lib/example/hello.ts` is a complete tiny agent, run end to end in `test/run.test.ts`.
