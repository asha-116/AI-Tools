// Builder (agents/builder/PROCEDURE.md), implemented conservatively: a free-tier model cannot be
// trusted to write production formula code, so the Builder does only the test-first half.
// From one `agent:builder` Issue it drafts, on `agent/builder/<n>-<slug>`:
//   (a) a known-answer fixture (every case cites a URL from the Issue, schema-validated),
//   (b) a test file that imports the planned tools-core function,
//   (c) a PLAN.md with the formula description,
// and opens a DRAFT PR saying a human / coding session must implement the function until CI is
// green. It never touches prices or legal text and refuses `needs-owner` Issues.

import {
  availableProviders,
  chatJson,
  Escalation,
  loadProviders,
  promptSections,
  redact,
  renderTemplate,
  runAgent,
  type AgentContext,
  type FileChange,
  type IssueSummary,
  type Provider,
  type RunOptions,
} from '../../lib/src/index.js';
import { planSchemaFor, type BuilderPlan } from '../schema.js';

export const BUDGET = { perRun: 60_000, daily: 120_000 };
export const TRIGGER_LABEL = 'agent:builder';
/** Issues with these labels need the owner (prices, legal text) — the Builder never does them. */
export const OWNER_ONLY_LABELS = ['type:pricing', 'type:legal'];
export const MIN_CASES = 10;

export type Formatter = (path: string, content: string) => Promise<string>;

export interface BuilderDeps {
  providers?: Provider[];
  /** Formats generated files so `prettier --check` passes; default: the repo's Prettier. */
  format?: Formatter;
}

export type BuildResult =
  | { skipped: string }
  | { refused: string }
  | { pr: number; url: string; branch: string; files: string[]; cases: number; family: string };

/** `--issue 1`, `--issue=1`, else env ISSUE_NUMBER. */
export function parseIssueNumber(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): number | undefined {
  let raw: string | undefined;
  argv.forEach((a, i) => {
    if (a === '--issue') raw = argv[i + 1];
    else if (a.startsWith('--issue=')) raw = a.slice(8);
  });
  raw ??= env.ISSUE_NUMBER;
  return raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : undefined;
}

/** https URLs in the text, deduped, trailing punctuation trimmed. */
export function issueUrls(text: string): string[] {
  const found = text.match(/https:\/\/[^\s)"'<>\]`|,]+/g) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.;:]+$/, '')))];
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Default formatter: the repo's own Prettier (a devDependency); unformatted if unavailable. */
export const prettierFormat: Formatter = async (path, content) => {
  try {
    const prettier = await import('prettier');
    const config = (await prettier.resolveConfig(path)) ?? {};
    return await prettier.format(content, { ...config, filepath: path });
  } catch {
    return content;
  }
};

export function fixtureJson(
  issue: IssueSummary,
  plan: BuilderPlan,
  family: string,
  today: string,
): string {
  const body = squash(issue.body);
  return `${JSON.stringify(
    {
      $comment: `DRAFT known-answer cases extracted by the Builder agent (model family: ${family}) from Issue #${String(issue.number)}. A human must open every source, confirm each figure and the quote, and fix or delete wrong cases BEFORE implementing ${plan.function_name}. quote_in_issue=false means the quote was not found verbatim in the Issue text.`,
      accessed: today,
      issue: issue.number,
      cases: plan.cases.map((c) => ({
        name: c.name,
        input: c.input,
        expect: c.expect,
        quote: c.quote,
        quote_in_issue: body.includes(squash(c.quote)),
        sources: [c.source],
      })),
    },
    null,
    2,
  )}\n`;
}

export function testFile(issue: IssueSummary, plan: BuilderPlan): string {
  const fn = plan.function_name;
  return `import { describe, expect, it } from 'vitest';
import known from './fixtures/${plan.slug}-known-answers.json' with { type: 'json' };
import { ${fn} } from '../src/index.js';

// Drafted by the Builder agent from Issue #${String(issue.number)} (tests first, AGENTS.md).
// ${fn} does not exist yet: implement it in tools-core/src (see tools-core/plans/${plan.slug}/PLAN.md)
// until these known answers pass. Tolerance: ₹1 or 0.01%, whichever is larger.
describe('${fn} — published known answers', () => {
  it('has at least ${String(MIN_CASES)} sourced cases', () => {
    expect(known.cases.length).toBeGreaterThanOrEqual(${String(MIN_CASES)});
    for (const c of known.cases) {
      expect(c.sources.length).toBeGreaterThan(0);
      for (const url of c.sources) expect(url).toMatch(/^https:\\/\\//);
    }
  });

  it.each(known.cases)('$name', ({ input, expect: want }) => {
    const got = ${fn}(input as never) as unknown as Record<string, number>;
    for (const [key, value] of Object.entries(want)) {
      const diff = Math.abs((got[key] ?? Number.NaN) - value);
      expect(diff).toBeLessThanOrEqual(Math.max(1, Math.abs(value) * 1e-4));
    }
  });
});
`;
}

export function planMarkdown(issue: IssueSummary, plan: BuilderPlan, family: string): string {
  const list = (xs: { name: string; description: string; unit: string }[]) =>
    xs.map((x) => `- \`${x.name}\` (${x.unit || '—'}): ${x.description}`).join('\n');
  return `# Plan: ${plan.title}

Drafted by the Builder agent (model family: ${family}) from Issue #${String(issue.number)}.
**Draft — a human checks every line against the cited sources before implementing.**

## Function

\`${plan.function_name}\` in \`tools-core/src/\`, exported from \`tools-core/src/index.ts\`.
Pure, no I/O, no hard-coded state rates (AGENTS.md rule 6).

## Formula (from the cited sources)

${plan.formula_description}

## Inputs

${list(plan.inputs)}

## Outputs

${list(plan.outputs)}

## Assumptions

${plan.assumptions.length ? plan.assumptions.map((a) => `- ${a}`).join('\n') : '- none stated'}

## Sources

${[...new Set(plan.cases.map((c) => c.source))].map((s) => `- ${s}`).join('\n') || '- see the Issue'}

## Notes for the implementer

${plan.notes || '—'}

1. Confirm every case in \`tools-core/test/fixtures/${plan.slug}-known-answers.json\` against its source.
2. Add cases until there are at least ${String(MIN_CASES)} (edge + typical).
3. Implement \`${plan.function_name}\` until \`npm run ci\` is green; add a Verifier registry entry
   in \`agents/verifier/src/formulas.ts\`.
4. Calculator UI (EN + HI, formula, assumptions, disclaimer) is a separate PR.
`;
}

function prBody(issue: IssueSummary, plan: BuilderPlan, family: string, files: string[]): string {
  const sources = [...new Set(plan.cases.map((c) => c.source))];
  const summary = {
    issue: issue.number,
    files_changed: files,
    known_answer_sources: sources,
    tests_added: plan.cases.length + 1,
    ci_local: 'fail',
    how_to_verify: [
      'Open each source and confirm every case and quote in the fixture.',
      `Implement ${plan.function_name} in tools-core/src and export it from index.ts.`,
      'Run npm run ci until green, then mark the PR ready for review.',
    ],
  };
  return `<!-- producer-family: ${family} -->
Refs #${String(issue.number)}

## Draft — needs a human to implement

The Builder only drafted the **tests-first** half: known-answer cases, a failing test file and a
plan. CI is **expected to fail** (\`${plan.function_name}\` does not exist yet). A human or coding
session must check the cases against the sources and implement the function until CI is green.
The Verifier re-computes cases with a different model family before merge.
${plan.cases.length < MIN_CASES ? `\n**Only ${String(plan.cases.length)} case(s) found — add at least ${String(MIN_CASES - plan.cases.length)} more from cited sources.**\n` : ''}
## Output

\`\`\`json
${JSON.stringify(summary, null, 2)}
\`\`\`

For estimation only — verify with a professional. No tax, legal or investment advice.
`;
}

function loadPrompt(ctx: AgentContext): { system: string; user: string } {
  const p = promptSections(ctx.readFile('prompt.md'));
  if (!p.system || !p.user)
    throw new Error('agents/builder/prompt.md needs "## system" and "## user"');
  return { system: p.system, user: p.user };
}

const escalation = (issue: number, title: string, context: string, key: string) =>
  new Escalation({
    title: `Builder: ${title} (Issue #${String(issue)})`,
    context,
    options: [
      'Add the missing information to the Issue and re-label it agent:builder.',
      'Do the work by hand and close the Issue.',
    ],
    recommendation:
      'Fix the Issue first; the Builder never guesses formulas, prices or legal text.',
    key: `builder-${key}-${String(issue)}`,
  });

export async function build(
  ctx: AgentContext,
  issueNumber: number,
  deps: BuilderDeps = {},
): Promise<BuildResult> {
  if (!ctx.config.githubToken) {
    const msg = `not configured: GITHUB_TOKEN is not set, so Issue #${String(issueNumber)} cannot be read — nothing built`;
    ctx.log.warn('builder.not_configured', { issue: issueNumber, reason: msg });
    return { skipped: msg };
  }
  const issues = await ctx.github.listIssues({
    state: 'open',
    labels: [TRIGGER_LABEL],
    limit: 500,
  });
  const issue = issues.find((i) => i.number === issueNumber);
  if (!issue)
    return refuse(
      ctx,
      issueNumber,
      `Issue #${String(issueNumber)} is not open with label ${TRIGGER_LABEL}`,
    );
  if (issue.labels.includes('needs-owner')) {
    return refuse(
      ctx,
      issueNumber,
      `Issue #${String(issueNumber)} is labelled needs-owner — waiting on the owner`,
    );
  }
  if (issue.labels.some((l) => OWNER_ONLY_LABELS.includes(l))) {
    throw escalation(
      issueNumber,
      'pricing/legal work is owner-only',
      'The Issue is labelled type:pricing or type:legal. Agents never change prices or legal text (AGENTS.md rule 3).',
      'owner-only',
    );
  }
  const urls = issueUrls(`${issue.title}\n${issue.body}`);
  if (!urls.length) {
    throw escalation(
      issueNumber,
      'no cited source',
      'The Issue cites no https source. Known-answer tests must come from an external, cited source (AGENTS.md "Tests first").',
      'no-source',
    );
  }

  const providers = deps.providers ?? loadProviders();
  if (!availableProviders(providers, ctx.config.env).length) {
    const msg = 'not configured: no LLM provider key set — nothing built';
    if (ctx.dryRun) {
      ctx.log.warn('builder.not_configured', { issue: issueNumber, reason: msg });
      return { skipped: msg };
    }
    throw escalation(issueNumber, 'no LLM provider configured', msg, 'no-llm');
  }

  const prompt = loadPrompt(ctx);
  const { data: plan, response } = await chatJson(
    ctx.llm,
    {
      messages: [
        { role: 'system', content: prompt.system },
        {
          role: 'user',
          content: renderTemplate(prompt.user, {
            number: issue.number,
            title: redact(issue.title).text,
            body: redact(issue.body).text,
            sources: urls.map((u) => `- ${u}`).join('\n'),
          }),
        },
      ],
      temperature: 0,
    },
    planSchemaFor(urls),
    'builder plan',
  );
  const family = response.family;
  if (plan.needs_pricing_or_legal) {
    throw escalation(
      issueNumber,
      'needs pricing or legal text',
      'The model reports the Issue needs prices, legal text or policies, which only the owner may change.',
      'owner-only',
    );
  }
  if (plan.sources_disagree) {
    throw escalation(
      issueNumber,
      'sources disagree',
      `The cited sources disagree on the formula or results. Notes: ${plan.notes}`,
      'disagree',
    );
  }
  if (!plan.cases.length) {
    throw escalation(
      issueNumber,
      'no worked examples',
      'No known-answer case with a cited source could be extracted from the Issue. Add quoted worked examples from the sources.',
      'no-cases',
    );
  }

  const fixturePath = `tools-core/test/fixtures/${plan.slug}-known-answers.json`;
  const testPath = `tools-core/test/${plan.slug}.test.ts`;
  const planPath = `tools-core/plans/${plan.slug}/PLAN.md`;
  for (const p of [fixturePath, testPath, planPath]) {
    if ((await ctx.github.getFile(p)) !== null) {
      throw escalation(
        issueNumber,
        'files already exist',
        `${p} already exists on main; the Builder does not overwrite work.`,
        'exists',
      );
    }
  }
  const format = deps.format ?? prettierFormat;
  const today = ctx.now().toISOString().slice(0, 10);
  const raw: [string, string][] = [
    [fixturePath, fixtureJson(issue, plan, family, today)],
    [testPath, testFile(issue, plan)],
    [planPath, planMarkdown(issue, plan, family)],
  ];
  const files: FileChange[] = [];
  for (const [path, content] of raw) files.push({ path, content: await format(path, content) });
  const paths = files.map((f) => f.path);
  const branch = `agent/builder/${String(issueNumber)}-${plan.slug}`;
  const pr = await ctx.github.openPullRequest({
    branch,
    title: `test(tools-core): known-answer cases for ${plan.function_name} (#${String(issueNumber)})`,
    body: prBody(issue, plan, family, paths),
    files,
    commitMessage: `test(tools-core): draft known-answer cases for ${plan.function_name}\n\nRefs #${String(issueNumber)}`,
    labels: [TRIGGER_LABEL],
    draft: true,
  });
  await ctx.github.upsertComment(
    issueNumber,
    `Draft PR ${pr.dryRun ? '(dry-run, not opened)' : pr.html_url}: ${String(plan.cases.length)} known-answer case(s), a failing test and a plan for \`${plan.function_name}\`. A human must check the cases against the sources and implement the function until CI is green.`,
  );
  ctx.log.info('builder.done', {
    issue: issueNumber,
    pr: pr.number,
    cases: plan.cases.length,
    family,
  });
  return {
    pr: pr.number,
    url: pr.html_url,
    branch,
    files: paths,
    cases: plan.cases.length,
    family,
  };
}

function refuse(ctx: AgentContext, issue: number, reason: string): BuildResult {
  ctx.log.warn('builder.refused', { issue, reason });
  return { refused: reason };
}

/** Entry point for `npm run agent -- builder --issue <n>` (or env ISSUE_NUMBER). */
export function main(
  options: RunOptions = {},
  argv: readonly string[] = process.argv.slice(2),
  deps: BuilderDeps = {},
) {
  return runAgent(
    'builder',
    BUDGET,
    async (ctx) => {
      const issue = parseIssueNumber(argv, ctx.config.env);
      if (issue === undefined)
        throw new Error('builder needs an Issue number: --issue <n> or env ISSUE_NUMBER');
      return build(ctx, issue, deps);
    },
    options,
  );
}
