import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/main.mjs';

const limitsFile = new URL('../../../data/free-tier-limits.json', import.meta.url).pathname;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'usage-main-'));
  mkdirSync(join(root, 'data'));
  copyFileSync(limitsFile, join(root, 'data/free-tier-limits.json'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const now = new Date('2026-10-01T03:37:00Z');

function githubFetch(minutesPerRun: number, openIssues: unknown[] = []) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let out: unknown;
    if (url.endsWith('/repos/o/r')) out = { private: true };
    else if (url.includes('/actions/runs?')) out = { workflow_runs: [{ id: 1 }] };
    else if (url.includes('/jobs')) {
      out = {
        jobs: [
          {
            started_at: '2026-09-01T00:00:00Z',
            completed_at: new Date(
              Date.parse('2026-09-01T00:00:00Z') + minutesPerRun * 60000,
            ).toISOString(),
            labels: ['ubuntu-latest'],
          },
        ],
      };
    } else if (url.includes('/issues?state=open')) out = openIssues;
    else if (method === 'POST' && url.endsWith('/issues'))
      out = { number: 42, html_url: 'https://x/42' };
    else out = {};
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return { f, calls };
}

describe('usage monitor run()', () => {
  it('writes the report and skips unconfigured collectors without failing', async () => {
    const logs: string[] = [];
    const outFile = join(root, 'gh-output');
    writeFileSync(outFile, '');
    const res = await run({
      argv: [],
      env: { GITHUB_OUTPUT: outFile },
      fetch: async () => {
        throw new Error('no network in this test');
      },
      now,
      root,
      log: (m) => logs.push(m),
    });
    const md = readFileSync(join(root, 'company/reports/usage/2026-09.md'), 'utf8');
    expect(md).toBe(res.report);
    expect(md).toContain('# Free-tier usage — 2026-09');
    expect(md).toContain('not configured (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)');
    expect(md).toContain('not configured (GITHUB_TOKEN / GITHUB_REPOSITORY)');
    expect(md).toContain('No agent logs yet');
    expect(res.alert).toBeNull();
    expect(readFileSync(outFile, 'utf8')).toBe(
      'month=2026-09\nreport=company/reports/usage/2026-09.md\nalert=false\n',
    );
    expect(logs).toEqual(['Wrote company/reports/usage/2026-09.md']);
  });

  it('opens a deduped needs-owner Issue when a limit is ≥ 70% (with --alert)', async () => {
    const { f, calls } = githubFetch(1500);
    const logs: string[] = [];
    const res = await run({
      argv: ['--month', '2026-09', '--alert', '--out-dir', 'out'],
      env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '7' },
      fetch: f,
      now,
      root,
      log: (m) => logs.push(m),
    });
    expect(res.reportPath).toBe('out/2026-09.md');
    expect(res.rows.find((r) => r.id === 'github-actions-minutes')).toMatchObject({
      used: 1500,
      percent: 75,
      status: 'alert',
    });
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/repos/o/r/issues'));
    expect(post?.body).toMatchObject({
      title: 'Free-tier usage at or above 70%',
      labels: ['needs-owner', 'type:infra', 'type:alert'],
    });
    expect((post?.body as { body: string }).body).toMatch(
      /^<!-- toolshop-alert:free-tier-usage -->/,
    );
    expect((post?.body as { body: string }).body).toContain(
      'https://github.com/o/r/actions/runs/7',
    );
    expect(res.issue).toEqual({ action: 'created', number: 42, url: 'https://x/42' });
    expect(logs).toContain('::warning::Free-tier usage at or above 70%');
  });

  it('comments on (and refreshes) the existing alert Issue instead of opening another', async () => {
    const existing = {
      number: 5,
      html_url: 'https://x/5',
      body: '<!-- toolshop-alert:free-tier-usage -->\nold',
    };
    const { f, calls } = githubFetch(1500, [existing]);
    const res = await run({
      argv: ['--alert'],
      env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' },
      fetch: f,
      now,
      root,
      log: () => {},
    });
    expect(res.issue).toEqual({ action: 'commented', number: 5, url: 'https://x/5' });
    expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/issues/5'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues/5/comments'))).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/repos/o/r/issues'))).toBe(
      false,
    );
  });

  it('does not write Issues in --dry-run or without --alert, and warns without a token', async () => {
    const { f, calls } = githubFetch(1500);
    await run({
      argv: ['--alert', '--dry-run'],
      env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' },
      fetch: f,
      now,
      root,
      log: () => {},
    });
    await run({
      argv: [],
      env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' },
      fetch: f,
      now,
      root,
      log: () => {},
    });
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);

    // An alert from Cloudflare data with no GitHub token: report still written, Issue skipped.
    const logs: string[] = [];
    const cf = async () =>
      new Response(
        JSON.stringify({
          data: {
            viewer: {
              accounts: [
                {
                  workersInvocationsAdaptive: [
                    { sum: { requests: 99000 }, dimensions: { date: '2026-09-03' } },
                  ],
                },
              ],
            },
          },
        }),
      );
    const res = await run({
      argv: ['--alert'],
      env: { CLOUDFLARE_API_TOKEN: 'c', CLOUDFLARE_ACCOUNT_ID: 'a' },
      fetch: cf,
      now,
      root,
      log: (m) => logs.push(m),
    });
    expect(res.alert).not.toBeNull();
    expect(res.issue).toBeNull();
    expect(logs).toContain(
      '::warning::Cannot open the alert Issue: GITHUB_TOKEN / GITHUB_REPOSITORY not set',
    );
    expect(logs.some((l) => l.startsWith('::warning::Cloudflare D1'))).toBe(true);
  });
});
