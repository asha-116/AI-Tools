// A tiny example agent. It is used only by agents/lib/test/example.test.ts to prove runAgent()
// works end to end in dry-run, and as a template for real agents' src/run.ts.

import { z } from 'zod';
import {
  chatJson,
  redact,
  renderTemplate,
  runAgent,
  type AgentContext,
  type RunOptions,
} from '../src/index.js';

// In a real agent this lives in agents/<name>/schema.ts.
export const HelloSchema = z.object({
  greeting: z.string().min(1).max(200),
  language: z.enum(['en', 'hi']),
});

// In a real agent this lives in agents/<name>/prompt.md and is read with ctx.readFile().
const PROMPT =
  'Greet {{who}} in {{language}}. Reply as JSON: {"greeting": string, "language": "en"|"hi"}.';

/** The agent's logic: pure apart from ctx, so it is easy to test. */
export async function hello(
  ctx: AgentContext,
  who: string,
): Promise<{ greeting: string; pr: number }> {
  const prompt = renderTemplate(PROMPT, { who: redact(who).text, language: 'hi' });
  const { data, response } = await chatJson(
    ctx.llm,
    { messages: [{ role: 'user', content: prompt }] },
    HelloSchema,
    'hello greeting',
  );
  ctx.log.info('hello.done', { language: data.language, family: response.family });
  const pr = await ctx.github.openPullRequest({
    branch: `agent/${ctx.name}/greeting`,
    title: 'docs: add greeting',
    body: `Producer model family: ${response.family}`,
    files: [{ path: 'company/reports/hello.md', content: `${data.greeting}\n` }],
  });
  return { greeting: data.greeting, pr: pr.number };
}

/** What agents/<name>/src/run.ts exports for the CLI. */
export function main(options?: RunOptions) {
  return runAgent(
    'hello',
    { perRun: 1_000, daily: 2_000 },
    (ctx) => hello(ctx, 'an estate agent'),
    options,
  );
}
