import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main as helloMain } from '../example/hello.js';
import { runCli } from '../src/cli.js';
import { BudgetExceeded, Escalation } from '../src/errors.js';
import { DEFAULT_REPOSITORY, exitCode, runAgent } from '../src/run.js';
import {
  completion,
  fakeFetch,
  fakeLlm,
  jsonResponse,
  MemoryGitHub,
  memoryLogger,
  testContext,
  testRunOptions,
} from '../src/testing.js';

const GOOD = '{"greeting":"नमस्ते","language":"hi"}';

describe('example hello agent, end to end in dry-run', () => {
  it('real LLM client + real GitHub client over a fake fetch: no writes leave the process', async () => {
    const key = 'test-key-' + 'q'.repeat(12);
    const f = fakeFetch((req) => {
      if (req.url.startsWith('https://llm.test/'))
        return jsonResponse(completion(GOOD, { prompt_tokens: 40, completion_tokens: 10 }));
      return jsonResponse({ message: 'unexpected' }, 500);
    });
    const dir = mkdtempSync(join(tmpdir(), 'agent-logs-'));
    const r = await helloMain({
      env: { LLM_KEY: key, GITHUB_TOKEN: 'gh-token-' + 'w'.repeat(12) },
      providers: [
        {
          id: 'fake',
          baseUrl: 'https://llm.test/v1',
          keyEnv: 'LLM_KEY',
          model: 'm',
          family: 'llama',
          limits: {},
        },
      ],
      fetch: f,
      logDir: dir,
      now: () => new Date('2026-10-06T10:00:00Z'),
    });
    expect(r).toEqual({ status: 'ok', result: { greeting: 'नमस्ते', pr: 0 }, tokens: 50 });
    // Only the LLM was called; the PR was a dry-run no-op.
    expect(f.calls.map((c) => new URL(c.url).host)).toEqual(['llm.test']);
    const lines = readFileSync(join(dir, 'hello', '2026-10-06.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map((l) => l.event)).toEqual([
      'run.start',
      'llm.usage',
      'hello.done',
      'github.dry-run',
      'run.end',
    ]);
    expect(lines.at(-1)).toMatchObject({
      status: 'ok',
      tokens: 50,
      families: ['llama'],
      dry_run: true,
    });
    expect(JSON.stringify(lines)).not.toContain(key);

    // A second run the same day sees the first run's tokens against the daily cap (2,000).
    const again = await helloMain({
      env: { LLM_KEY: key },
      providers: [
        {
          id: 'fake',
          baseUrl: 'https://llm.test/v1',
          keyEnv: 'LLM_KEY',
          model: 'm',
          family: 'llama',
          limits: {},
        },
      ],
      fetch: f,
      logDir: dir,
      now: () => new Date('2026-10-06T11:00:00Z'),
    });
    expect(again.status).toBe('ok');
    const start = readFileSync(join(dir, 'hello', '2026-10-06.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.event === 'run.start');
    expect(start[1]).toMatchObject({ used_before_run: 50, budget_daily: 2000 });
  });

  it('with test fakes: records the PR on the agent branch', async () => {
    const github = new MemoryGitHub({ agent: 'hello', dryRun: true });
    const r = await helloMain(testRunOptions('hello', { llm: fakeLlm([GOOD]), github }));
    expect(r.status).toBe('ok');
    expect(github.writes).toHaveLength(1);
    expect(github.writes[0]?.args).toMatchObject({ branch: 'agent/hello/greeting' });
  });

  it('invalid output twice → Escalation → one needs-owner Issue, status escalated', async () => {
    const github = new MemoryGitHub({ agent: 'hello', dryRun: true });
    const logger = memoryLogger('hello');
    const r = await helloMain(
      testRunOptions('hello', { llm: fakeLlm(['{}', 'nope']), github, logger }),
    );
    expect(r.status).toBe('escalated');
    expect(r.escalation).toMatchObject({ deduped: false });
    expect(github.issues[0]?.labels).toContain('needs-owner');
    expect(exitCode(r)).toBe(0);
    expect(logger.lines.at(-1)).toMatchObject({ event: 'run.end', status: 'escalated' });
  });
});

describe('runAgent', () => {
  it('rejects a bad agent name', async () => {
    await expect(runAgent('Bad Name', 1, async () => 1)).rejects.toThrow(/invalid agent name/);
  });

  it('stops cleanly on BudgetExceeded and logs it', async () => {
    const logger = memoryLogger('x');
    const r = await runAgent(
      'x',
      10,
      async (ctx) => {
        ctx.budget.charge({ prompt: 11, completion: 0 });
      },
      testRunOptions('x', { logger }),
    );
    expect(r).toMatchObject({ status: 'budget_exceeded', tokens: 11 });
    expect(exitCode(r)).toBe(0);
    expect(logger.lines.map((l) => l.event)).toEqual(['run.start', 'budget.exceeded', 'run.end']);
  });

  it('reports unexpected errors with a scrubbed message and exit code 1', async () => {
    const secret = 'secret-value-' + 'k'.repeat(10);
    const logger = memoryLogger('x', [secret]);
    const r = await runAgent(
      'x',
      10,
      async () => {
        throw new Error(`boom ${secret} for a@b.com`);
      },
      testRunOptions('x', { logger, env: { API_KEY: secret } }),
    );
    expect(r).toMatchObject({ status: 'error', error: 'boom [SECRET] for [EMAIL_1]' });
    expect(exitCode(r)).toBe(1);
    expect(JSON.stringify(logger.lines)).not.toContain(secret);
  });

  it('a non-Error throw is still reported', async () => {
    const r = await runAgent('x', 10, () => Promise.reject('plain'), testRunOptions('x'));
    expect(r).toMatchObject({ status: 'error', error: 'plain' });
  });

  it('an Escalation that cannot be filed becomes an error', async () => {
    const github = new MemoryGitHub({ agent: 'x' });
    github.listIssues = async () => {
      throw new Error('GitHub down');
    };
    const r = await runAgent(
      'x',
      10,
      async () => {
        throw new Escalation({
          title: 'Need help',
          context: 'c',
          options: ['a'],
          recommendation: 'a',
        });
      },
      testRunOptions('x', { github }),
    );
    expect(r.status).toBe('error');
  });

  it('ctx.escalate files an Issue without stopping the run and links the Actions run', async () => {
    const github = new MemoryGitHub({ agent: 'x' });
    const r = await runAgent(
      'x',
      10,
      async (ctx) => {
        await ctx.escalate({ title: 'FYI', context: 'c', options: ['a'], recommendation: 'a' });
        return 'done';
      },
      testRunOptions('x', {
        github,
        env: {
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_REPOSITORY: 'o/r',
          GITHUB_RUN_ID: '9',
        },
      }),
    );
    expect(r).toMatchObject({ status: 'ok', result: 'done' });
    expect(github.issues[0]?.body).toContain('https://github.com/o/r/actions/runs/9');
  });

  it('wires real clients from env when nothing is injected (dry-run default)', async () => {
    const f = fakeFetch(() => jsonResponse([]));
    const dir = mkdtempSync(join(tmpdir(), 'agent-logs-'));
    const r = await runAgent(
      'x',
      { perRun: 5, daily: 5 },
      async (ctx) => {
        expect(ctx.dryRun).toBe(true);
        expect(ctx.config.repository).toBeUndefined();
        const issues = await ctx.github.listIssues();
        await expect(ctx.llm.chat({ messages: [] })).rejects.toThrow(/no LLM provider/);
        expect(() => ctx.readFile('../x')).toThrow(/invalid/);
        return issues.length;
      },
      {
        env: { GITHUB_RUN_ID: '77' },
        fetch: f,
        logDir: dir,
        sleep: async () => undefined,
        random: () => 0,
      },
    );
    expect(r).toMatchObject({ status: 'ok', result: 0 });
    expect(f.calls[0]?.url).toContain(`/repos/${DEFAULT_REPOSITORY}/issues`);
  });
});

describe('testing helpers', () => {
  it('fakeLlm returns queued replies, throws queued errors, and fails when empty', async () => {
    const llm = fakeLlm(['a', new Error('x'), { text: 'b', family: 'qwen' }], { family: 'gemini' });
    expect((await llm.chat({ messages: [] })).family).toBe('gemini');
    await expect(llm.chat({ messages: [] })).rejects.toThrow('x');
    expect((await llm.chat({ messages: [] })).text).toBe('b');
    expect(llm.familiesUsed()).toEqual(['gemini', 'qwen']);
    expect(llm.remaining()).toBe(0);
    await expect(llm.chat({ messages: [] })).rejects.toThrow(/no queued reply/);
  });

  it('fakeLlm charges a budget', async () => {
    const ctx = testContext('x', { budget: 20 });
    const llm = fakeLlm(['a', 'b'], { budget: ctx.budget });
    await llm.chat({ messages: [] });
    await expect(llm.chat({ messages: [] })).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it('fakeFetch records URL objects, Request inputs and non-JSON bodies', async () => {
    const f = fakeFetch(() => jsonResponse(null, 204));
    await f(new URL('https://a.test/x'), { method: 'POST', body: 'not json' });
    await f(new Request('https://b.test/y'));
    expect(f.calls).toEqual([
      { url: 'https://a.test/x', method: 'POST', headers: {}, body: 'not json' },
      { url: 'https://b.test/y', method: 'GET', headers: {}, body: undefined },
    ]);
  });

  it('MemoryGitHub filters, searches, labels and refuses non-agent branches', async () => {
    const mem = new MemoryGitHub({
      agent: 'qa',
      issues: [
        { title: 'Stale rates', labels: ['type:data'] },
        { title: 'Closed one', state: 'closed', body: 'stale' },
      ],
      pulls: [
        {
          number: 10,
          title: 'p',
          body: '',
          labels: [],
          state: 'open',
          html_url: 'u',
          head: { ref: 'agent/qa/a', sha: 'x' },
          base: 'main',
          draft: false,
          updated_at: '',
        },
      ],
      files: { 'a.md': 'A' },
    });
    expect((await mem.listIssues({ labels: ['type:data'] })).map((i) => i.number)).toEqual([1]);
    expect(await mem.listIssues({ state: 'all' })).toHaveLength(2);
    expect((await mem.searchIssues('label:x STALE')).map((i) => i.number)).toEqual([1, 2]);
    expect(await mem.listPulls({ head: 'agent/qa/a' })).toHaveLength(1);
    expect(await mem.listPulls({ state: 'closed' })).toHaveLength(0);
    expect(await mem.getFile('a.md')).toBe('A');
    expect(await mem.getFile('b.md')).toBeNull();
    await mem.addLabels(1, ['priority:high', 'type:data']);
    await mem.addLabels(99, ['x']);
    expect(mem.issues[0]?.labels).toEqual(['type:data', 'priority:high']);
    await expect(
      mem.openPullRequest({ branch: 'main', title: '', body: '', files: [] }),
    ).rejects.toThrow(/refusing/);
    const pr = await mem.openPullRequest({
      branch: 'agent/qa/b',
      title: 't',
      body: '',
      files: [],
      labels: ['x'],
      draft: true,
      base: 'dev',
    });
    expect(pr.number).toBe(11);
    expect(mem.pulls.at(-1)).toMatchObject({ base: 'dev', draft: true, labels: ['x'] });
    expect(
      await mem.setCommitStatus('s', { state: 'success', context: 'qa', description: 'ok' }),
    ).toMatchObject({ number: 0 });
    expect(mem.writes.map((w) => w.action)).toEqual([
      'addLabels',
      'addLabels',
      'openPullRequest',
      'setCommitStatus',
    ]);
  });

  it('MemoryGitHub defaults', async () => {
    const mem = new MemoryGitHub();
    expect(mem.agent).toBe('test');
    expect(mem.dryRun).toBe(false);
    expect(await mem.listIssues()).toEqual([]);
  });

  it('testContext provides working defaults', async () => {
    const ctx = testContext('orchestrator', { env: { DRY_RUN: 'false' }, now: () => new Date(0) });
    expect(ctx.dryRun).toBe(false);
    expect(ctx.now().getTime()).toBe(0);
    expect(ctx.readFile('PROCEDURE.md')).toContain('# Orchestrator');
    const e = await ctx.escalate({
      title: 'Goals empty',
      context: 'c',
      options: ['a'],
      recommendation: 'a',
    });
    expect(e.deduped).toBe(false);
    const d = testContext('x');
    expect(d.dryRun).toBe(true);
    expect(d.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('cli', () => {
  const lines: string[] = [];
  const print = (l: string): void => void lines.push(l);

  it('usage errors exit 2', async () => {
    expect(await runCli([], undefined, print)).toBe(2);
    expect(await runCli(['lib'], undefined, print)).toBe(2);
    expect(await runCli(['../x'], undefined, print)).toBe(2);
  });

  it('a missing or malformed agent module exits 2', async () => {
    expect(await runCli(['ghost'], undefined, print)).toBe(2);
    expect(lines.at(-1)).toMatch(/cannot load agent "ghost"/);
    expect(await runCli(['x'], async () => ({}), print)).toBe(2);
    expect(lines.at(-1)).toMatch(/must export main/);
    expect(await runCli(['x'], () => Promise.reject('nope'), print)).toBe(2);
  });

  it('runs main() and maps the status to an exit code', async () => {
    const ok = await runCli(
      ['hello'],
      async () => ({ main: async () => ({ status: 'ok' as const, tokens: 3 }) }),
      print,
    );
    expect(ok).toBe(0);
    expect(lines.at(-1)).toBe('hello: ok (3 tokens)');
    const bad = await runCli(
      ['hello'],
      async () => ({ main: async () => ({ status: 'error' as const, tokens: 0 }) }),
      print,
    );
    expect(bad).toBe(1);
  });

  it('prints to stderr by default', async () => {
    const original = process.stderr.write.bind(process.stderr);
    const out: string[] = [];
    process.stderr.write = ((s: string) => (out.push(s), true)) as typeof process.stderr.write;
    try {
      await runCli([]);
    } finally {
      process.stderr.write = original;
    }
    expect(out[0]).toMatch(/usage/);
  });
});
