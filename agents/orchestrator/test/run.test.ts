import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BudgetExceeded,
  LlmUnavailable,
  type IssueSummary,
  type PullSummary,
} from '../../lib/src/index.js';
import {
  fakeFetch,
  fakeLlm,
  jsonResponse,
  MemoryGitHub,
  memoryLogger,
  testContext,
  testRunOptions,
  type FakeReply,
} from '../../lib/src/testing.js';
import { OutputSchema } from '../schema.js';
import {
  main,
  orchestrate,
  promptVars,
  stateSummary,
  type OrchestrateOptions,
} from '../src/run.js';
import type { WorkflowRun } from '../src/state.js';
import { candidate, tempRepo } from './helpers.js';

const PROMPT = readFileSync(join(import.meta.dirname, '..', 'prompt.md'), 'utf8');
const NOW = new Date('2026-10-06T00:47:00Z'); // 06:17 IST
const GOALS = '# Goals\n\n## This week\n\n- Collect 50 waitlist sign-ups\n';

/** MemoryGitHub whose search answers per exact query (it otherwise ignores qualifiers). */
class TestGitHub extends MemoryGitHub {
  search: Record<string, IssueSummary[]> = {};
  override async searchIssues(query: string) {
    return this.search[query] ?? [];
  }
}

function repo(extra: Record<string, string> = {}) {
  return tempRepo({
    'agents/orchestrator/prompt.md': PROMPT,
    'company/goals.md': GOALS,
    'data/stamp-duty/KA.json': JSON.stringify({ last_verified: '2026-01-01' }),
    'data/fresh.json': JSON.stringify({ last_verified: '2026-09-29' }),
    'company/reports/daily/2026-10-05.md': '# Daily report — 2026-10-05\n\n- quiet day',
    'company/memory/2026-10.md': '- orchestrator: keep tasks small',
    ...extra,
  });
}

const failingRun: WorkflowRun = {
  name: 'Deploy',
  path: '.github/workflows/deploy.yml',
  status: 'completed',
  conclusion: 'failure',
  html_url: 'https://github.com/o/r/actions/runs/1',
  created_at: '2026-10-05T10:00:00Z',
};

function pull(n: number, labels: string[]): PullSummary {
  return {
    number: n,
    title: `PR ${n}`,
    body: '',
    labels,
    state: 'open',
    html_url: `https://github.com/o/r/pull/${n}`,
    head: { ref: `b${n}`, sha: 'x' },
    base: 'main',
    draft: false,
    updated_at: '2026-10-01T00:00:00Z',
  };
}

function setup(
  replies: FakeReply[],
  o: {
    files?: Record<string, string>;
    env?: Record<string, string>;
    runs?: OrchestrateOptions['listRuns'];
  } = {},
) {
  const root = repo(o.files);
  const github = new TestGitHub({
    agent: 'orchestrator',
    dryRun: true,
    issues: [
      {
        title: 'Build stamp duty calculator for Karnataka',
        labels: ['agent:builder', 'type:tool'],
        updated_at: '2026-09-01T00:00:00Z',
      },
      {
        title: 'Pick the first paid template',
        labels: ['needs-owner'],
        updated_at: '2026-10-05T00:00:00Z',
      },
      { title: 'Ask ramesh@example.com about leads', updated_at: '2026-10-05T00:00:00Z' },
    ],
    pulls: [pull(20, ['needs-owner'])],
  });
  github.search['is:pr is:merged merged:2026-10-05'] = [
    {
      number: 19,
      title: 'feat: EMI page',
      body: '',
      labels: [],
      state: 'closed',
      html_url: 'https://github.com/o/r/pull/19',
      updated_at: '2026-10-05T00:00:00Z',
      is_pull_request: true,
    },
  ];
  const llm = fakeLlm(replies, { family: 'gemini' });
  const log = memoryLogger('orchestrator');
  const ctx = testContext('orchestrator', {
    github,
    llm,
    logger: log,
    repoRoot: root,
    now: () => NOW,
    env: { DRY_RUN: 'true', ...o.env },
  });
  const opts: OrchestrateOptions = { listRuns: o.runs ?? (async () => [failingRun]) };
  return { root, github, llm, log, ctx, opts };
}

const draft = (cands: unknown[]) => JSON.stringify({ candidates: cands });

describe('orchestrate', () => {
  it('plans ≤ 5 deduplicated Issues and opens the daily report PR', async () => {
    const summary = join(tempRepo({}), 'summary.md');
    const s = setup(
      [
        draft([
          candidate({
            title: 'Build Karnataka stamp duty calculator',
            type: 'tool',
            impact: 5,
            effort: 1,
          }),
          candidate({
            title: 'Add a waitlist call-to-action to the EMI page',
            impact: 5,
            effort: 2,
          }),
          candidate({
            title: 'Propose launch price for the lead tracker',
            agent: 'engineer',
            type: 'product',
            needs_owner: true,
            impact: 2,
            effort: 2,
          }),
        ]),
      ],
      {
        env: {
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_REPOSITORY: 'o/r',
          GITHUB_RUN_ID: '77',
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );
    const r = await orchestrate(s.ctx, s.opts);

    // LLM prompt: goals and state in, PII out.
    const sent = s.llm.requests[0]?.messages ?? [];
    expect(sent[0]?.content).toContain('Set agent to engineer');
    expect(sent[1]?.content).toContain('What already exists');
    expect(sent[1]?.content).toContain('Collect 50 waitlist sign-ups');
    expect(sent[1]?.content).toContain('Failing workflows: Deploy');
    expect(sent[1]?.content).toContain('- quiet day');
    expect(sent[1]?.content).toContain('keep tasks small');
    expect(sent[1]?.content).not.toContain('ramesh@example.com');
    expect(s.llm.requests[0]?.jsonMode).toBe(true);

    // Issues: duplicate dropped; ranked by impact ÷ effort; needs-owner flagged.
    const created = s.github.writes
      .filter((w) => w.action === 'createIssue')
      .map((w) => w.args as { title: string; labels: string[]; body: string });
    expect(created.map((c) => c.title)).toEqual([
      'Add a waitlist call-to-action to the EMI page',
      'Fix failing workflow: Deploy',
      'Re-verify data/stamp-duty/KA.json (last verified 2026-01-01)',
      'Propose launch price for the lead tracker',
    ]);
    expect(created[3]?.labels).toEqual(['agent:engineer', 'type:product', 'needs-owner']);
    // Non-calculator work never goes to the Builder (it would bounce back to the owner).
    expect(created[0]?.labels[0]).toBe('agent:engineer');
    expect(created[1]?.labels[0]).toBe('agent:engineer');
    expect(created[0]?.body).toContain('https://github.com/o/r/actions/runs/77');
    expect(r.issues).toHaveLength(4);
    expect(() => OutputSchema.parse(r)).not.toThrow();
    expect(r.llm).toEqual({ status: 'used', family: 'gemini', candidates: 3 });

    // Report on disk, in the job summary and in the PR.
    expect(r.reportPath).toBe('company/reports/daily/2026-10-06.md');
    const onDisk = readFileSync(join(s.root, r.reportPath), 'utf8');
    expect(onDisk).toBe(r.report_markdown);
    expect(readFileSync(summary, 'utf8')).toContain('# Daily report — 2026-10-06');
    expect(onDisk).toContain('[#19](https://github.com/o/r/pull/19) feat: EMI page');
    expect(onDisk).toContain('Build Karnataka stamp duty calculator ≈ #1 Build stamp duty');
    expect(onDisk).toContain('Pick the first paid template');
    expect(onDisk).toContain('[#20](https://github.com/o/r/pull/20) PR 20 — `needs-owner`');
    expect(onDisk).toContain('Build stamp duty calculator for Karnataka — 35 days');
    expect(onDisk).not.toContain('ramesh@example.com');
    const pr = s.github.writes.find((w) => w.action === 'openPullRequest')?.args as {
      branch: string;
      files: { path: string; content: string }[];
      labels: string[];
    };
    expect(pr.branch).toBe('agent/orchestrator/2026-10-06');
    expect(pr.files).toEqual([{ path: r.reportPath, content: r.report_markdown }]);
    expect(pr.labels).toEqual(['agent:orchestrator']);
    expect(s.log.lines.map((l) => l['event'])).toEqual(
      expect.arrayContaining(['state', 'llm.used', 'issues', 'report']),
    );
  });

  it('keeps at most 5 Issues', async () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
    const many = words.map((w) => candidate({ title: `${w} ${w}-work`, impact: 3, effort: 1 }));
    const s = setup([draft(many)], { runs: async () => [] });
    const r = await orchestrate(s.ctx, s.opts);
    expect(r.issues).toHaveLength(5);
  });

  it('without an LLM provider: skips the LLM step, still plans state tasks and reports', async () => {
    const s = setup([new LlmUnavailable([])]);
    const r = await orchestrate(s.ctx, s.opts);
    expect(r.llm).toEqual({
      status: 'skipped',
      reason: 'no LLM provider configured (no API key set)',
    });
    expect(r.issues.map((i) => i.title)).toEqual([
      'Fix failing workflow: Deploy',
      'Re-verify data/stamp-duty/KA.json (last verified 2026-01-01)',
    ]);
    expect(r.report_markdown).toContain('LLM step **skipped**: no LLM provider configured');
    expect(s.log.lines.some((l) => l['event'] === 'llm.skipped')).toBe(true);
  });

  it('records a provider outage as failed', async () => {
    const s = setup([
      new LlmUnavailable([{ provider: 'gemini', status: 503, reason: 'http 503' }]),
    ]);
    const r = await orchestrate(s.ctx, s.opts);
    expect(r.llm.status).toBe('failed');
    expect(r.issues).toHaveLength(2);
  });

  it('escalates invalid output twice but still writes the report', async () => {
    const s = setup(['{}', 'not json']);
    const r = await orchestrate(s.ctx, s.opts);
    expect(r.llm).toEqual({
      status: 'failed',
      reason: 'invalid model output twice (asked the owner)',
    });
    expect(s.github.issues.some((i) => i.title === 'Invalid orchestrator plan after retry')).toBe(
      true,
    );
    expect(r.report_markdown).toContain('LLM step **failed**');
  });

  it('notes a failed escalation instead of crashing', async () => {
    const s = setup(['{}', '{}']);
    // A failed read is tolerated in dry runs (lib escalate); a failed write is not.
    const create = s.github.createIssue.bind(s.github);
    s.github.createIssue = async (issue) => {
      if (issue.labels?.includes('needs-owner')) throw new Error('boom');
      return create(issue);
    };
    const r = await orchestrate(s.ctx, s.opts);
    expect(r.report_markdown).toContain('Could not open the needs-owner Issue');
  });

  it('asks the owner when goals are empty and makes no LLM call', async () => {
    const s = setup([], { files: { 'company/goals.md': '# Goals\n\n## This week\n' } });
    const r = await orchestrate(s.ctx, s.opts);
    expect(s.llm.requests).toHaveLength(0);
    expect(r.llm.status).toBe('skipped');
    const esc = s.github.issues.find((i) => i.title.includes('goals.md has no goals'));
    expect(esc?.labels).toContain('needs-owner');
  });

  it('treats a missing goals file as empty', async () => {
    const s = setup([]);
    const { rmSync } = await import('node:fs');
    rmSync(join(s.root, 'company/goals.md'));
    const r = await orchestrate(s.ctx, s.opts);
    expect(r.llm.status).toBe('skipped');
  });

  it('opens nothing when open Issues cannot be read, and says why', async () => {
    const s = setup([]);
    s.github.listIssues = async () => {
      throw new Error('GitHub GET /repos/o/r/issues → 404');
    };
    s.github.listPulls = async () => {
      throw new Error('nope');
    };
    const r = await orchestrate(s.ctx, {
      listRuns: async () => {
        throw new Error('403');
      },
    });
    expect(r.issues).toEqual([]);
    expect(s.llm.requests).toHaveLength(0);
    expect(r.llm).toEqual({
      status: 'skipped',
      reason:
        'open Issues could not be read (duplicates unknown); also no LLM provider configured (no API key set)',
    });
    expect(r.report_markdown).toContain('Could not read open Issues');
    expect(r.report_markdown).toContain('Unavailable this run');
    expect(r.report_markdown).toContain('1 candidate task(s) not opened');
    expect(s.log.lines.filter((l) => l['event'] === 'read.failed')).toHaveLength(3);
  });

  it('does not claim a missing provider when a key is set', async () => {
    const s = setup([], { env: { GROQ_API_KEY: 'gsk_test_key_value' } });
    s.github.listIssues = async () => {
      throw new Error('down');
    };
    const r = await orchestrate(s.ctx, s.opts);
    expect(r.llm).toEqual({
      status: 'skipped',
      reason: 'open Issues could not be read (duplicates unknown)',
    });
  });

  it('lets unexpected LLM errors and budget stops through', async () => {
    const s = setup([new Error('kaboom')]);
    await expect(orchestrate(s.ctx, s.opts)).rejects.toThrow('kaboom');
    const b = setup([]);
    await expect(
      orchestrate(b.ctx, {
        listRuns: async () => {
          throw new BudgetExceeded('orchestrator', 'run', 1, 2);
        },
      }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
    expect(existsSync(join(b.root, 'company/reports/daily/2026-10-06.md'))).toBe(false);
  });
});

describe('prompt helpers', () => {
  it('fills placeholders for empty inputs', () => {
    const v = promptVars({
      date: '2026-10-06',
      goals: ' - g ',
      state: 's',
      openIssues: [],
      reports: [],
      memory: '',
    });
    expect(v).toMatchObject({ open_issues: '(none)', reports: '(none yet)', memory: '(none yet)' });
  });

  it('summarises unknown state', () => {
    const out = stateSummary({
      merged: null,
      staleCount: null,
      ownerCount: 1,
      waitingCount: null,
      failing: null,
      staleData: [],
    });
    expect(out).toContain('Merged yesterday: unknown');
    expect(out).toContain('Owner queue: 1 needs-owner Issue(s), unknown PR(s) waiting');
    expect(out).toContain('Failing workflows: unknown');
    expect(
      stateSummary({
        merged: [],
        staleCount: 0,
        ownerCount: 0,
        waitingCount: 0,
        failing: [],
        staleData: [],
      }),
    ).toContain('Merged yesterday: none');
  });
});

describe('main', () => {
  it('runs end to end in dry-run with no LLM key and reads Actions via fetch', async () => {
    const root = repo();
    const fetch = fakeFetch(() => jsonResponse({ workflow_runs: [] }));
    const github = new TestGitHub({ agent: 'orchestrator', dryRun: true });
    const r = await main(
      testRunOptions('orchestrator', {
        cwd: root,
        env: { DRY_RUN: 'true' },
        llm: fakeLlm([new LlmUnavailable([])]),
        github,
        fetch,
        now: () => NOW,
      }),
    );
    expect(r.status).toBe('ok');
    expect(fetch.calls[0]?.url).toContain('/repos/asha-116/AI-Tools/actions/runs');
    expect(github.writes.map((w) => w.action)).toEqual(['createIssue', 'openPullRequest']);
    expect(existsSync(join(root, 'company/reports/daily/2026-10-06.md'))).toBe(true);
  });

  it('works without injected fetch (listRuns failure is only a note)', async () => {
    const root = repo();
    const github = new TestGitHub({ agent: 'orchestrator', dryRun: true });
    const original = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse({}, 500)) as typeof fetch;
    try {
      const r = await main(
        testRunOptions('orchestrator', {
          cwd: root,
          llm: fakeLlm([new LlmUnavailable([])]),
          github,
          now: () => NOW,
        }),
      );
      expect(r.status).toBe('ok');
      expect(readFileSync(join(root, 'company/reports/daily/2026-10-06.md'), 'utf8')).toContain(
        'Could not read workflow runs',
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
