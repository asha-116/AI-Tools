import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryGitHub, memoryLogger, testContext, testRunOptions } from '../../lib/src/testing.js';
import {
  controller,
  controllerDeps,
  d1OrdersReader,
  defaultExec,
  missingConfig,
  parseWranglerJson,
  repoPath,
  wranglerConfig,
  type ExecFn,
} from '../src/main.js';
import { main, SQL_EXPORT } from '../src/run.js';
import { fakeRazorpay, rawPayments, rawRefunds, rawSettlements } from './fixtures.js';

const CATALOG = readFileSync(new URL('../../../products/catalog.json', import.meta.url), 'utf8');
const D1_ID = '01234567-89ab-cdef-0123-456789abcdef';
const ENV = {
  DRY_RUN: 'true',
  RAZORPAY_KEY_ID: 'rzp_test_k',
  RAZORPAY_KEY_SECRET: 'secret-value',
  ALLOW_DRAFT_PRODUCTS: 'true',
  CLOUDFLARE_API_TOKEN: 'cf-token-123',
  CLOUDFLARE_ACCOUNT_ID: 'acct',
  ORDERS_D1_ID: D1_ID,
};
const TUESDAY = new Date('2026-10-06T03:00:00Z'); // business day 2026-10-05

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctrl-'));
  const deps = controllerDeps(testContext('controller', { repoRoot: root }));
  void deps.writeFile('products/catalog.json', CATALOG);
  return root;
}

const wranglerOut = (rows: unknown[]) =>
  `⛅️ wrangler 4.143.0\n${JSON.stringify([{ results: rows, success: true, meta: {} }])}\n`;

function recordingExec(
  stdout: string,
): ExecFn & { calls: { file: string; args: readonly string[]; config: string }[] } {
  const calls: { file: string; args: readonly string[]; config: string }[] = [];
  const fn: ExecFn = async (file, args) => {
    const cfg = args[args.indexOf('--config') + 1] ?? '';
    calls.push({ file, args, config: readFileSync(cfg, 'utf8') });
    return { stdout };
  };
  return Object.assign(fn, { calls });
}

describe('config helpers', () => {
  it('lists missing env per service', () => {
    expect(missingConfig({})).toEqual({
      razorpay: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
      cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'ORDERS_D1_ID'],
    });
    expect(missingConfig(ENV)).toEqual({ razorpay: [], cloudflare: [] });
  });

  it('builds a wrangler config only for a UUID', () => {
    expect(wranglerConfig(D1_ID)).toContain(`database_id = "${D1_ID}"`);
    expect(() => wranglerConfig('x"; evil')).toThrow('UUID');
  });

  it('parses wrangler JSON with noise and refuses failed queries', () => {
    expect(parseWranglerJson('[{"results":[],"success":true}]')).toEqual([
      { results: [], success: true },
    ]);
    expect(parseWranglerJson(wranglerOut([{ a: 1 }]))).toEqual([
      { results: [{ a: 1 }], success: true, meta: {} },
    ]);
    expect(parseWranglerJson('{"results":[]}')).toEqual({ results: [] });
    expect(() => parseWranglerJson('nothing here')).toThrow('no JSON');
    expect(() => parseWranglerJson('[{"success":false}]')).toThrow('D1 query failed');
    expect(parseWranglerJson('[null]')).toEqual([null]);
  });

  it('refuses paths outside the repo', () => {
    expect(repoPath('/r', 'company/ledger/sales.csv')).toBe('/r/company/ledger/sales.csv');
    for (const p of ['', '/etc/passwd', '../x', 'a//b']) expect(() => repoPath('/r', p)).toThrow();
  });

  it('defaultExec runs a real process', async () => {
    const r = await defaultExec(process.execPath, ['-e', 'process.stdout.write("ok")'], {
      cwd: tmpdir(),
      env: process.env,
      maxBuffer: 1024,
    });
    expect(r.stdout).toBe('ok');
  });
});

describe('d1OrdersReader', () => {
  it('runs the pinned wrangler with a temp config and cleans up', async () => {
    const exec = recordingExec(wranglerOut([]));
    const before = readdirSync(tmpdir()).filter((f) => f.startsWith('controller-d1-')).length;
    await d1OrdersReader(ENV, exec)();
    const call = exec.calls[0];
    expect(call?.file).toBe('npx');
    expect(call?.args.slice(0, 8)).toEqual([
      '--yes',
      'wrangler@4.143.0',
      'd1',
      'execute',
      'toolshop-orders',
      '--remote',
      '--json',
      '--config',
    ]);
    expect(call?.args.slice(-2)).toEqual(['--command', SQL_EXPORT]);
    expect(call?.config).toContain(D1_ID);
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('controller-d1-')).length).toBe(before);
  });

  it('honours WRANGLER and rejects a bad database id', async () => {
    const exec = recordingExec('[]');
    await d1OrdersReader({ ...ENV, WRANGLER: 'wrangler' }, exec)();
    expect(exec.calls[0]?.file).toBe('wrangler');
    expect(exec.calls[0]?.args[0]).toBe('d1');
    await expect(d1OrdersReader({}, exec)()).rejects.toThrow('UUID');
    await expect(d1OrdersReader({ ...ENV, WRANGLER: ' ' }, exec)()).resolves.toEqual([]);
  });
});

describe('controller wiring', () => {
  it('skips with "not configured" when keys are missing', async () => {
    const log = memoryLogger('controller');
    const ctx = testContext('controller', { logger: log, env: { DRY_RUN: 'true' } });
    const r = await controller(ctx);
    expect(r).toEqual({
      status: 'not_configured',
      missing: [
        'RAZORPAY_KEY_ID',
        'RAZORPAY_KEY_SECRET',
        'CLOUDFLARE_API_TOKEN',
        'CLOUDFLARE_ACCOUNT_ID',
        'ORDERS_D1_ID',
      ],
    });
    expect(log.lines.some((l) => l['event'] === 'controller.not_configured')).toBe(true);
  });

  it('runs the pipeline: ledger on disk, Issue and PR through the lib client', async () => {
    const root = tempRoot();
    const github = new MemoryGitHub({ agent: 'controller', dryRun: true });
    const log = memoryLogger('controller');
    const ctx = testContext('controller', {
      github,
      logger: log,
      env: ENV,
      repoRoot: root,
      now: () => TUESDAY,
    });
    const rzp = fakeRazorpay({
      payments: rawPayments,
      refunds: rawRefunds,
      settlements: rawSettlements,
    });
    const exec = recordingExec(wranglerOut([]));
    const r = await controller(ctx, { fetch: rzp.fetch, exec });
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    expect(r.day).toBe('2026-10-05');
    expect(r.written).toContain('company/ledger/sales.csv');
    const sales = readFileSync(join(root, 'company/ledger/sales.csv'), 'utf8');
    expect(sales.split('\n')[0]).toBe(
      'date,payment_id,order_id,product_slug,amount_inr,fee_inr,tax_on_fee_inr,status',
    );

    const pr = github.writes.find((w) => w.action === 'openPullRequest')?.args as {
      branch: string;
      files: { path: string; content: string }[];
    };
    expect(pr.branch).toBe('agent/controller/2026-10-05');
    expect(pr.files.find((f) => f.path === 'company/ledger/sales.csv')?.content).toBe(sales);
    // No D1 orders → every captured payment lacks a delivery → one type:bug Issue.
    const issue = github.writes.find((w) => w.action === 'createIssue')?.args as {
      labels: string[];
    };
    expect(issue.labels).toEqual(['type:bug', 'agent:controller']);
    expect(log.lines.map((l) => l['event'])).toEqual(
      expect.arrayContaining(['controller_start', 'issue', 'pull_request', 'controller_done']),
    );
  });

  it('reads a missing file as null and fails a PR for an unwritten path', async () => {
    const root = tempRoot();
    const deps = controllerDeps(testContext('controller', { repoRoot: root, env: ENV }));
    expect(await deps.readFile('company/ledger/nope.csv')).toBeNull();
    await expect(deps.readFile('products')).rejects.toThrow('EISDIR');
    await expect(
      deps.github.openPullRequest({
        branch: 'agent/controller/x',
        title: 't',
        body: 'b',
        paths: ['company/ledger/nope.csv'],
        labels: [],
      }),
    ).rejects.toThrow('was not written');
    expect(typeof deps.fetch).toBe('function');
  });
});

describe('main', () => {
  it('exits ok (not configured) with no keys', async () => {
    const r = await main(testRunOptions('controller', { env: { DRY_RUN: 'true' } }));
    expect(r.status).toBe('ok');
    expect(r.result).toMatchObject({ status: 'not_configured' });
  });

  it('passes injected fetch and exec through', async () => {
    const root = tempRoot();
    const rzp = fakeRazorpay({ payments: [], refunds: [], settlements: [] });
    const exec = recordingExec(wranglerOut([]));
    const r = await main({
      ...testRunOptions('controller', {
        env: ENV,
        cwd: root,
        now: () => TUESDAY,
        fetch: rzp.fetch as unknown as typeof fetch,
      }),
      exec,
    });
    expect(r.status).toBe('ok');
    expect(exec.calls).toHaveLength(1);
    expect(rzp.calls.length).toBeGreaterThan(0);
    expect(existsSync(join(root, 'company/ledger/sales.csv'))).toBe(true);
  });
});
