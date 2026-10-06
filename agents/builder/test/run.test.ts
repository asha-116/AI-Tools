import { describe, expect, it } from 'vitest';
import { LlmUnavailable, type OpenPullRequest } from '../../lib/src/index.js';
import { fakeLlm, MemoryGitHub, testContext, testRunOptions } from '../../lib/src/testing.js';
import { BuilderPlanSchema, planSchemaFor } from '../schema.js';
import {
  build,
  issueUrls,
  main,
  parseIssueNumber,
  prettierFormat,
  type BuilderDeps,
} from '../src/run.js';

const SRC = 'https://en.wikipedia.org/wiki/Equated_monthly_installment';
const SRC2 = 'https://emicalculator.net/';
const ISSUE_BODY = `Build an EMI function.

Sources: ${SRC} and ${SRC2}.

> 10,000,000 at 10.5% … 120 months … EMI = 134,935
`;
const ENV = { DRY_RUN: 'true', GITHUB_TOKEN: 'ghs_test_token', GROQ_API_KEY: 'gsk_test_key_1' };

const plan = (over: Record<string, unknown> = {}) => ({
  function_name: 'computeLoanEmi',
  slug: 'loan-emi',
  title: 'Loan EMI',
  formula_description: 'EMI = P × r × (1 + r)^n / ((1 + r)^n − 1), r = annual % / 1200',
  inputs: [
    { name: 'principal', description: 'loan amount', unit: '₹' },
    { name: 'annualRatePercent', description: 'rate', unit: '%' },
    { name: 'tenureMonths', description: 'months', unit: '' },
  ],
  outputs: [{ name: 'emi', description: 'monthly instalment', unit: '₹' }],
  assumptions: ['Rate is fixed'],
  cases: [
    {
      name: '₹1 crore at 10.5% for 120 months',
      input: { principal: 10000000, annualRatePercent: 10.5, tenureMonths: 120 },
      expect: { emi: 134935 },
      quote: '10,000,000 at 10.5% … 120 months … EMI = 134,935',
      source: SRC,
    },
    {
      name: 'second',
      input: { principal: 1000000, annualRatePercent: 10.5, tenureMonths: 120 },
      expect: { emi: 13493 },
      quote: 'not in the issue',
      source: SRC2,
    },
  ],
  sources_disagree: false,
  needs_pricing_or_legal: false,
  notes: '',
  ...over,
});

const issue = (over: Record<string, unknown> = {}) => ({
  number: 7,
  title: 'EMI calculator',
  body: ISSUE_BODY,
  labels: ['agent:builder', 'type:tool'],
  ...over,
});

const identity = async (_p: string, c: string) => c;

async function run(
  o: {
    replies?: Parameters<typeof fakeLlm>[0];
    issue?: Record<string, unknown>;
    env?: Record<string, string>;
    files?: Record<string, string>;
    deps?: BuilderDeps;
    number?: number;
  } = {},
) {
  const github = new MemoryGitHub({
    agent: 'builder',
    dryRun: true,
    issues: [issue(o.issue)],
    ...(o.files ? { files: o.files } : {}),
  });
  const llm = fakeLlm(o.replies ?? [JSON.stringify(plan())], { family: 'llama' });
  const ctx = testContext('builder', { github, llm, env: o.env ?? ENV });
  const result = await build(ctx, o.number ?? 7, { format: identity, ...o.deps });
  return { result, github, llm };
}

const opened = (g: MemoryGitHub) =>
  g.writes.find((w) => w.action === 'openPullRequest')?.args as OpenPullRequest;

describe('helpers', () => {
  it('parseIssueNumber reads --issue, --issue= and ISSUE_NUMBER', () => {
    expect(parseIssueNumber(['builder', '--issue', '1'], {})).toBe(1);
    expect(parseIssueNumber(['--issue=22'], {})).toBe(22);
    expect(parseIssueNumber([], { ISSUE_NUMBER: '5' })).toBe(5);
    expect(parseIssueNumber(['--issue', 'x'], {})).toBeUndefined();
    expect(parseIssueNumber([], {})).toBeUndefined();
  });

  it('issueUrls keeps https links only', () => {
    expect(issueUrls(`a ${SRC}. b http://x.in (${SRC2}) ${SRC}`)).toEqual([SRC, SRC2]);
  });

  it('prettierFormat formats JSON with the repo config and falls back on errors', async () => {
    expect(await prettierFormat('x.json', '{"a":[1]}')).toBe('{ "a": [1] }\n');
    expect(await prettierFormat('x.unknown-ext', 'keep me')).toBe('keep me');
  });
});

describe('planSchemaFor', () => {
  it('accepts sources cited in the Issue and declared keys', () => {
    expect(planSchemaFor([SRC, SRC2]).safeParse(plan()).success).toBe(true);
  });
  it('rejects uncited sources and undeclared keys', () => {
    const bad = plan({
      cases: [
        {
          name: 'x',
          input: { foo: 1 },
          expect: { bar: 2 },
          quote: 'q',
          source: 'https://made-up.in/',
        },
      ],
    });
    const r = planSchemaFor([SRC]).safeParse(bad);
    expect(r.success).toBe(false);
    const msgs = r.error?.issues.map((i) => i.message) ?? [];
    expect(msgs).toEqual([
      'source "https://made-up.in/" is not a URL cited in the Issue',
      'unknown input "foo"',
      'unknown output "bar"',
    ]);
    expect(BuilderPlanSchema.safeParse(plan({ slug: 'Bad Slug' })).success).toBe(false);
  });
});

describe('build', () => {
  it('opens a draft PR on agent/builder/<n>-<slug> with fixture, failing test and plan', async () => {
    const { result, github, llm } = await run();
    expect(result).toMatchObject({ branch: 'agent/builder/7-loan-emi', cases: 2, family: 'llama' });
    const pr = opened(github);
    expect(pr.draft).toBe(true);
    expect(pr.labels).toEqual(['agent:builder']);
    expect(pr.files.map((f) => f.path)).toEqual([
      'tools-core/test/fixtures/loan-emi-known-answers.json',
      'tools-core/test/loan-emi.test.ts',
      'tools-core/plans/loan-emi/PLAN.md',
    ]);
    expect(pr.body).toContain('<!-- producer-family: llama -->');
    expect(pr.body).toContain('Refs #7');
    expect(pr.body).toContain('Only 2 case(s) found');
    expect(pr.body).toContain('"ci_local": "fail"');
    const fixture = JSON.parse(pr.files[0]?.content ?? '') as {
      issue: number;
      accessed: string;
      cases: { quote_in_issue: boolean; sources: string[] }[];
    };
    expect(fixture.issue).toBe(7);
    expect(fixture.accessed).toBe('2026-01-01');
    expect(fixture.cases.map((c) => c.quote_in_issue)).toEqual([true, false]);
    expect(fixture.cases[0]?.sources).toEqual([SRC]);
    expect(pr.files[1]?.content).toContain("import { computeLoanEmi } from '../src/index.js';");
    expect(pr.files[1]?.content).toContain("from './fixtures/loan-emi-known-answers.json'");
    expect(pr.files[2]?.content).toContain('EMI = P × r × (1 + r)^n');
    expect(github.comments.get(7)?.[0]).toContain('(dry-run, not opened)');
    // The model sees only the Issue and its cited sources; never asked to write code.
    expect(llm.requests[0]?.messages[1]?.content).toContain(`- ${SRC}`);
    expect(llm.requests[0]?.temperature).toBe(0);
  });

  it('formats generated files with Prettier by default', async () => {
    const github = new MemoryGitHub({ agent: 'builder', dryRun: true, issues: [issue()] });
    const llm = fakeLlm([JSON.stringify(plan())], { family: 'llama' });
    await build(testContext('builder', { github, llm, env: ENV }), 7);
    const pr = opened(github);
    for (const f of pr.files) {
      expect(await prettierFormat(f.path, f.content as string)).toBe(f.content);
    }
  });

  it('does not nag about case count with 10+ cases and handles empty plan parts', async () => {
    const base = plan().cases[0] as Record<string, unknown>;
    const cases = Array.from({ length: 10 }, (_, i) => ({ ...base, name: `c${String(i)}` }));
    const { github } = await run({
      replies: [JSON.stringify(plan({ cases, assumptions: [], notes: 'check rounding' }))],
    });
    const pr = opened(github);
    expect(pr.body).not.toContain('Only');
    expect(pr.files[2]?.content).toContain('- none stated');
    expect(pr.files[2]?.content).toContain('check rounding');
  });

  it('skips with a clear message when GITHUB_TOKEN is not set', async () => {
    const { result } = await run({ env: { DRY_RUN: 'true' } });
    expect(result).toEqual({ skipped: expect.stringContaining('not configured: GITHUB_TOKEN') });
  });

  it('skips in dry-run when no LLM provider key is set', async () => {
    const { result, llm } = await run({ env: { DRY_RUN: 'true', GITHUB_TOKEN: 'ghs_x' } });
    expect(result).toEqual({ skipped: 'not configured: no LLM provider key set — nothing built' });
    expect(llm.requests).toHaveLength(0);
  });

  it('escalates live runs with no LLM provider key', async () => {
    await expect(run({ env: { DRY_RUN: 'false', GITHUB_TOKEN: 'ghs_x' } })).rejects.toThrow(
      'no LLM provider configured',
    );
  });

  it('refuses Issues that are missing, unlabelled or needs-owner', async () => {
    expect((await run({ number: 99 })).result).toEqual({
      refused: 'Issue #99 is not open with label agent:builder',
    });
    expect((await run({ issue: { labels: ['type:tool'] } })).result).toHaveProperty('refused');
    const r = await run({ issue: { labels: ['agent:builder', 'needs-owner'] } });
    expect(r.result).toEqual({ refused: expect.stringContaining('needs-owner') });
    expect(r.llm.requests).toHaveLength(0);
  });

  it('escalates pricing/legal Issues and Issues without sources', async () => {
    await expect(run({ issue: { labels: ['agent:builder', 'type:pricing'] } })).rejects.toThrow(
      'owner-only',
    );
    await expect(run({ issue: { body: 'no links here' } })).rejects.toThrow('no cited source');
  });

  it('escalates when the model flags pricing/legal, disagreement or finds no cases', async () => {
    await expect(
      run({ replies: [JSON.stringify(plan({ needs_pricing_or_legal: true }))] }),
    ).rejects.toThrow('needs pricing or legal text');
    await expect(
      run({ replies: [JSON.stringify(plan({ sources_disagree: true }))] }),
    ).rejects.toThrow('sources disagree');
    await expect(run({ replies: [JSON.stringify(plan({ cases: [] }))] })).rejects.toThrow(
      'no worked examples',
    );
  });

  it('never overwrites existing files', async () => {
    await expect(run({ files: { 'tools-core/test/loan-emi.test.ts': 'x' } })).rejects.toThrow(
      'files already exist',
    );
  });

  it('retries once on an invented source, then escalates', async () => {
    const bad = JSON.stringify(
      plan({ cases: [{ ...(plan().cases[0] as object), source: 'https://invented.example/' }] }),
    );
    const ok = await run({ replies: [bad, JSON.stringify(plan())] });
    expect(ok.result).toHaveProperty('pr');
    await expect(run({ replies: [bad, bad] })).rejects.toThrow('Invalid builder plan after retry');
  });

  it('errors when prompt.md lacks a section', async () => {
    const github = new MemoryGitHub({ agent: 'builder', issues: [issue()] });
    const ctx = testContext('builder', { github, env: ENV, repoRoot: '/nonexistent-root' });
    await expect(build(ctx, 7)).rejects.toThrow();
    const ctx2 = {
      ...testContext('builder', { github, env: ENV }),
      readFile: () => '## system\nx',
    };
    await expect(build(ctx2, 7)).rejects.toThrow('needs "## system" and "## user"');
  });
});

describe('main()', () => {
  it('needs an Issue number', async () => {
    const r = await main(testRunOptions('builder'), []);
    expect(r.status).toBe('error');
  });

  it('turns escalations into a needs-owner Issue and exits ok', async () => {
    const github = new MemoryGitHub({
      agent: 'builder',
      dryRun: true,
      issues: [issue({ body: 'none' })],
    });
    const r = await main(testRunOptions('builder', { env: ENV, github }), ['--issue', '7']);
    expect(r.status).toBe('escalated');
    expect(github.writes[0]?.action).toBe('createIssue');
  });

  it('builds end to end', async () => {
    const github = new MemoryGitHub({ agent: 'builder', dryRun: true, issues: [issue()] });
    const llm = fakeLlm([JSON.stringify(plan())]);
    const r = await main(testRunOptions('builder', { env: ENV, github, llm }), ['--issue', '7'], {
      format: identity,
    });
    expect(r).toMatchObject({ status: 'ok', result: { branch: 'agent/builder/7-loan-emi' } });
  });

  it('reports provider outages as errors', async () => {
    const github = new MemoryGitHub({ agent: 'builder', dryRun: true, issues: [issue()] });
    const llm = fakeLlm([new LlmUnavailable([])]);
    const r = await main(testRunOptions('builder', { env: ENV, github, llm }), ['--issue=7']);
    expect(r.status).toBe('error');
  });
});
