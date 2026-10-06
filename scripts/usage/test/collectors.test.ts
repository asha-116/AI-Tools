import { describe, expect, it } from 'vitest';
import {
  CF_GRAPHQL,
  CLOUDFLARE_IDS,
  cloudflareMeasurements,
  collectCloudflare,
  collectGitHubActions,
  mapLimit,
} from '../src/collectors.mjs';
import { resolvePeriod } from '../src/core.mjs';

const period = resolvePeriod('2026-09', new Date('2026-10-01T03:37:00Z'));
const multipliers = { linux: 1, windows: 2, macos: 10 };
const r2Classes = { a: ['PutObject', 'ListObjects'], b: ['GetObject', 'HeadObject'] };

type Handler = (url: string, init?: RequestInit) => unknown;
function fakeFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const out = handler(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return { f, calls };
}

const job = (mins: number, extra = {}) => ({
  started_at: '2026-09-01T10:00:00Z',
  completed_at: new Date(Date.parse('2026-09-01T10:00:00Z') + mins * 60000).toISOString(),
  conclusion: 'success',
  labels: ['ubuntu-latest'],
  ...extra,
});

describe('mapLimit', () => {
  it('keeps order and never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let max = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(max).toBe(2);
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
  });
});

describe('collectGitHubActions', () => {
  it('is skipped with a clear reason without a token', async () => {
    const { f, calls } = fakeFetch(() => ({}));
    const res = await collectGitHubActions({ fetch: f, repo: 'o/r', period, multipliers });
    expect(res).toEqual({
      measurements: [],
      notCollected: {
        'github-actions-minutes': 'not configured (GITHUB_TOKEN / GITHUB_REPOSITORY)',
      },
    });
    expect(calls).toHaveLength(0);
  });

  it('sums billed job minutes over the month’s runs (private repo)', async () => {
    const { f, calls } = fakeFetch((url) => {
      if (url.endsWith('/repos/o/r')) return { private: true };
      if (url.includes('/actions/runs?')) return { workflow_runs: [{ id: 1 }, { id: 2 }] };
      if (url.includes('/runs/1/jobs'))
        return { jobs: [job(8.5), job(0.2), job(5, { conclusion: 'skipped' })] };
      if (url.includes('/runs/2/jobs')) return { jobs: [job(1, { labels: ['windows-latest'] })] };
      throw new Error(`unexpected ${url}`);
    });
    const res = await collectGitHubActions({
      fetch: f,
      token: 't',
      repo: 'o/r',
      period,
      multipliers,
    });
    expect(res.measurements).toEqual([
      { id: 'github-actions-minutes', value: 9 + 1 + 2, detail: '2 runs' },
    ]);
    expect(calls.some((c) => c.url.includes('created=2026-09-01..2026-09-30'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/runs/1/jobs?filter=all&per_page=100&page=1'))).toBe(
      true,
    );
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer t');
  });

  it('marks a public repo as unlimited and flags the 1000-run API cap', async () => {
    const runs = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const { f } = fakeFetch((url) => {
      if (url.endsWith('/repos/o/r')) return { private: false };
      if (url.includes('/actions/runs?')) return { workflow_runs: runs };
      return { jobs: [] };
    });
    const res = await collectGitHubActions({
      fetch: f,
      token: 't',
      repo: 'o/r',
      period,
      multipliers,
    });
    expect(res.measurements[0]).toEqual({
      id: 'github-actions-minutes',
      value: 0,
      detail: '1000 runs (API cap reached — undercount)',
      unlimited: 'public repo: standard runners are free',
    });
  });

  it('reports API errors as an error row instead of throwing', async () => {
    const { f } = fakeFetch(() => new Response('{"message":"Bad credentials"}', { status: 401 }));
    const res = await collectGitHubActions({
      fetch: f,
      token: 't',
      repo: 'o/r',
      period,
      multipliers,
    });
    expect(res.measurements[0].id).toBe('github-actions-minutes');
    expect(res.measurements[0].error).toMatch(/401/);
  });
});

const fullResults = {
  workers: {
    workersInvocationsAdaptive: [
      { sum: { requests: 40000 }, dimensions: { date: '2026-09-10' } },
      { sum: { requests: 35000 }, dimensions: { date: '2026-09-10' } },
      { sum: { requests: 1000 }, dimensions: { date: '2026-09-11' } },
    ],
  },
  d1: {
    d1AnalyticsAdaptiveGroups: [
      { sum: { rowsRead: 100, rowsWritten: 7 }, dimensions: { date: '2026-09-01' } },
      { sum: { rowsRead: 50, rowsWritten: 9 }, dimensions: { date: '2026-09-02' } },
    ],
  },
  d1Storage: {
    d1StorageAdaptiveGroups: [
      { max: { databaseSizeBytes: 1_000_000_000 } },
      { max: { databaseSizeBytes: 500_000_000 } },
    ],
  },
  r2Storage: { r2StorageAdaptiveGroups: [{ max: { payloadSize: 2e9, metadataSize: 1e6 } }] },
  r2Ops: {
    r2OperationsAdaptiveGroups: [
      { sum: { requests: 5 }, dimensions: { actionType: 'PutObject' } },
      { sum: { requests: 2 }, dimensions: { actionType: 'ListObjects' } },
      { sum: { requests: 40 }, dimensions: { actionType: 'GetObject' } },
      { sum: { requests: 9 }, dimensions: { actionType: 'DeleteObject' } },
    ],
  },
};

describe('cloudflareMeasurements', () => {
  it('maps every dataset to its limit id (daily peaks, storage in GB, R2 classes)', () => {
    expect(cloudflareMeasurements(fullResults, r2Classes)).toEqual([
      {
        id: 'workers-requests',
        value: 75000,
        peakDate: '2026-09-10',
        detail: '2 day(s) with data',
      },
      { id: 'd1-rows-read', value: 100, peakDate: '2026-09-01', detail: '2 day(s) with data' },
      { id: 'd1-rows-written', value: 9, peakDate: '2026-09-02', detail: '2 day(s) with data' },
      { id: 'd1-storage', value: 1.5, detail: '2 database(s)' },
      { id: 'r2-storage', value: 2.001, detail: '1 bucket(s)' },
      { id: 'r2-class-a', value: 7 },
      { id: 'r2-class-b', value: 40 },
    ]);
  });

  it('turns per-dataset errors and malformed answers into error rows', () => {
    const out = cloudflareMeasurements(
      { ...fullResults, workers: { error: 'not authorized' }, d1Storage: {} },
      r2Classes,
    );
    expect(out[0]).toEqual({ id: 'workers-requests', error: 'not authorized' });
    expect(out.find((m) => m.id === 'd1-storage')?.error).toMatch(/^unexpected response/);
    expect(out.find((m) => m.id === 'd1-rows-read')?.value).toBe(100);
  });

  it('treats missing numbers as zero', () => {
    const out = cloudflareMeasurements(
      {
        ...fullResults,
        d1Storage: { d1StorageAdaptiveGroups: [{ max: {} }] },
        r2Storage: { r2StorageAdaptiveGroups: [{ max: {} }] },
        r2Ops: {
          r2OperationsAdaptiveGroups: [{ sum: {}, dimensions: { actionType: 'GetObject' } }],
        },
        workers: { workersInvocationsAdaptive: [{ sum: {}, dimensions: { date: '2026-09-01' } }] },
      },
      r2Classes,
    );
    expect(out.find((m) => m.id === 'd1-storage')?.value).toBe(0);
    expect(out.find((m) => m.id === 'r2-storage')?.value).toBe(0);
    expect(out.find((m) => m.id === 'r2-class-b')?.value).toBe(0);
    expect(out.find((m) => m.id === 'workers-requests')?.value).toBe(0);
  });
});

describe('collectCloudflare', () => {
  it('is skipped with a clear reason without token/account', async () => {
    const { f, calls } = fakeFetch(() => ({}));
    const res = await collectCloudflare({ fetch: f, token: 't', period, r2Classes });
    expect(res.measurements).toEqual([]);
    expect(Object.keys(res.notCollected)).toEqual(CLOUDFLARE_IDS);
    expect(res.notCollected['r2-storage']).toMatch(/not configured/);
    expect(calls).toHaveLength(0);
  });

  it('sends one GraphQL query per dataset with the period variables', async () => {
    const { f, calls } = fakeFetch((_url, init) => {
      const { query } = JSON.parse(String(init?.body));
      const key = Object.keys(fullResults).find((k) =>
        query.includes(Object.keys(fullResults[k as keyof typeof fullResults])[0]),
      ) as keyof typeof fullResults;
      return { data: { viewer: { accounts: [fullResults[key]] } } };
    });
    const res = await collectCloudflare({
      fetch: f,
      token: 'cf',
      accountId: 'acc',
      period,
      r2Classes,
    });
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      expect(c.url).toBe(CF_GRAPHQL);
      expect((c.init?.headers as Record<string, string>).authorization).toBe('Bearer cf');
      expect(JSON.parse(String(c.init?.body)).variables).toEqual({
        a: 'acc',
        s: '2026-09-01',
        e: '2026-09-30',
        st: '2026-09-01T00:00:00Z',
        et: '2026-09-30T23:59:59Z',
      });
    }
    expect(res.measurements).toEqual(cloudflareMeasurements(fullResults, r2Classes));
  });

  it('reports HTTP, GraphQL, account and network errors per dataset', async () => {
    let n = 0;
    const { f } = fakeFetch(() => {
      n++;
      if (n === 1) return new Response('nope', { status: 500 });
      if (n === 2) return { errors: [{ message: 'not authorized for d1' }] };
      if (n === 3) return { data: { viewer: { accounts: [] } } };
      if (n === 4) throw new Error('socket hang up');
      return { data: { viewer: { accounts: [fullResults.r2Ops] } } };
    });
    const res = await collectCloudflare({
      fetch: f,
      token: 'cf',
      accountId: 'acc',
      period,
      r2Classes,
    });
    const byId = Object.fromEntries(res.measurements.map((m) => [m.id, m]));
    expect(byId['workers-requests'].error).toBe('HTTP 500');
    expect(byId['d1-rows-read'].error).toBe('not authorized for d1');
    expect(byId['d1-storage'].error).toMatch(/account not found/);
    expect(byId['r2-storage'].error).toBe('socket hang up');
    expect(byId['r2-class-a'].value).toBe(7);
  });
});
