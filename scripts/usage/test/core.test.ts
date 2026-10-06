import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildUsageAlert,
  evaluate,
  formatNumber,
  formatReport,
  jobBilledMinutes,
  parseLimits,
  peakDay,
  percentOf,
  resolvePeriod,
} from '../src/core.mjs';

const realDoc = JSON.parse(
  readFileSync(new URL('../../../data/free-tier-limits.json', import.meta.url), 'utf8'),
);

function doc(overrides: Record<string, unknown> = {}) {
  return {
    alert_threshold_percent: 70,
    limits: [
      {
        id: 'workers-requests',
        service: 'Cloudflare Workers',
        metric: 'Requests',
        unit: 'requests',
        window: 'day',
        limit: 100000,
        source: 'https://example.com/workers',
        last_verified: '2026-09-29',
      },
      {
        id: 'github-actions-minutes',
        service: 'GitHub Actions',
        metric: 'Minutes',
        unit: 'min',
        window: 'month',
        limit: 2000,
        source: 'https://example.com/gh',
        last_verified: '2026-09-29',
      },
    ],
    github_runner_multipliers: { linux: 1, windows: 2, macos: 10 },
    r2_operation_classes: { class_a: ['PutObject'], class_b: ['GetObject'] },
    ...overrides,
  };
}

const config = parseLimits(doc());
const period = resolvePeriod('2026-09', new Date('2026-10-01T03:37:00Z'));

describe('parseLimits', () => {
  it('accepts the real data file and mirrors COSTS.md numbers', () => {
    const c = parseLimits(realDoc);
    expect(c.threshold).toBe(70);
    const byId = Object.fromEntries(c.limits.map((l) => [l.id, l.limit]));
    expect(byId).toMatchObject({
      'github-actions-minutes': 2000,
      'workers-requests': 100000,
      'd1-rows-read': 5000000,
      'd1-rows-written': 100000,
      'r2-storage': 10,
      'r2-class-a': 1000000,
      'r2-class-b': 10000000,
    });
    expect(c.r2Classes.a).toContain('PutObject');
    expect(c.r2Classes.b).toContain('GetObject');
  });

  it('rejects bad documents with every problem listed', () => {
    expect(() => parseLimits({})).toThrow(/alert_threshold_percent[\s\S]*non-empty[\s\S]*linux/);
    const bad = doc({
      limits: [
        { id: 'x', window: 'week', limit: 0, source: 'http://x', last_verified: '29-09-2026' },
        { id: 'x' },
        {},
      ],
      github_runner_multipliers: { linux: 1, windows: 2, macos: 0 },
      r2_operation_classes: {},
    });
    const err = (() => {
      try {
        parseLimits(bad);
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    })();
    for (const part of [
      'missing "service"',
      '"window" must be',
      '"limit" must be a positive',
      'https URL',
      'YYYY-MM-DD',
      'duplicate id',
      'needs an "id"',
      'macos',
      'class_a',
    ]) {
      expect(err).toContain(part);
    }
  });
});

describe('resolvePeriod', () => {
  it('defaults to the previous full month', () => {
    expect(resolvePeriod(undefined, new Date('2026-10-01T03:37:00Z'))).toEqual({
      month: '2026-09',
      start: '2026-09-01',
      end: '2026-09-30',
      startTime: '2026-09-01T00:00:00Z',
      endTime: '2026-09-30T23:59:59Z',
      partial: false,
    });
  });
  it('wraps January to December of the previous year', () => {
    const p = resolvePeriod('previous', new Date('2027-01-01T03:00:00Z'));
    expect(p.month).toBe('2026-12');
    expect(p.end).toBe('2026-12-31');
  });
  it('handles leap-year February', () => {
    expect(resolvePeriod('2028-02', new Date('2028-05-01T00:00:00Z')).end).toBe('2028-02-29');
    expect(resolvePeriod('2027-02', new Date('2028-05-01T00:00:00Z')).end).toBe('2027-02-28');
  });
  it('"current" is month to date', () => {
    const p = resolvePeriod('current', new Date('2026-10-06T12:34:56.789Z'));
    expect(p).toMatchObject({ month: '2026-10', end: '2026-10-06', partial: true });
    expect(p.endTime).toBe('2026-10-06T12:34:56Z');
  });
  it('rejects bad and future months', () => {
    const now = new Date('2026-10-06T00:00:00Z');
    expect(() => resolvePeriod('2026-13', now)).toThrow(/YYYY-MM/);
    expect(() => resolvePeriod('sept', now)).toThrow(/YYYY-MM/);
    expect(() => resolvePeriod('2026-11', now)).toThrow(/future/);
  });
});

describe('jobBilledMinutes', () => {
  const m = { linux: 1, windows: 2, macos: 10 };
  const job = (start: string, end: string, extra = {}) => ({
    started_at: `2026-09-01T10:${start}Z`,
    completed_at: `2026-09-01T10:${end}Z`,
    conclusion: 'success',
    labels: ['ubuntu-latest'],
    ...extra,
  });
  it('rounds each job up to the whole minute', () => {
    expect(jobBilledMinutes(job('00:00', '00:01'), m)).toBe(1);
    expect(jobBilledMinutes(job('00:00', '01:00'), m)).toBe(1);
    expect(jobBilledMinutes(job('00:00', '01:01'), m)).toBe(2);
    expect(jobBilledMinutes(job('00:00', '08:30'), m)).toBe(9);
  });
  it('applies OS multipliers', () => {
    expect(jobBilledMinutes(job('00:00', '01:30', { labels: ['windows-latest'] }), m)).toBe(4);
    expect(jobBilledMinutes(job('00:00', '00:10', { labels: ['macos-14'] }), m)).toBe(10);
    expect(jobBilledMinutes(job('00:00', '00:10', { labels: undefined }), m)).toBe(1);
  });
  it('costs nothing for skipped, unstarted or zero-length jobs', () => {
    expect(jobBilledMinutes(job('00:00', '05:00', { conclusion: 'skipped' }), m)).toBe(0);
    expect(jobBilledMinutes({ started_at: null, completed_at: null }, m)).toBe(0);
    expect(jobBilledMinutes(job('00:00', '00:00'), m)).toBe(0);
    expect(jobBilledMinutes({ started_at: 'x', completed_at: 'y' }, m)).toBe(0);
  });
});

describe('peakDay', () => {
  it('sums per date and returns the busiest day (earliest on ties)', () => {
    expect(
      peakDay([
        { date: '2026-09-02', value: 10 },
        { date: '2026-09-01', value: 30 },
        { date: '2026-09-02', value: 20 },
        { date: '2026-09-03', value: 5 },
        { date: '', value: 999 },
        { date: '2026-09-04', value: Number.NaN },
      ]),
    ).toEqual({ value: 30, date: '2026-09-01', days: 3 });
  });
  it('is zero without data', () => {
    expect(peakDay([])).toEqual({ value: 0, date: undefined, days: 0 });
  });
});

describe('evaluate (70% threshold)', () => {
  it('percent rounds to one decimal', () => {
    expect(percentOf(1399, 2000)).toBe(70);
    expect(percentOf(1, 3)).toBe(33.3);
  });
  it('flags exactly 70% and above, not 69.9%', () => {
    const rows = evaluate(config, [
      { id: 'workers-requests', value: 69900, peakDate: '2026-09-12' },
      { id: 'github-actions-minutes', value: 1400, detail: '90 runs' },
    ]);
    expect(rows.map((r) => [r.id, r.percent, r.status])).toEqual([
      ['workers-requests', 69.9, 'ok'],
      ['github-actions-minutes', 70, 'alert'],
    ]);
    expect(rows[0].detail).toBe('peak day 2026-09-12');
    expect(rows[1].detail).toBe('90 runs');
  });
  it('marks errors, unlimited and not-collected rows without a percentage', () => {
    const rows = evaluate(
      config,
      [
        { id: 'workers-requests', error: 'HTTP 403' },
        { id: 'github-actions-minutes', value: 5000, unlimited: 'public repo', detail: '3 runs' },
      ],
      {},
    );
    expect(rows[0]).toMatchObject({ status: 'error', percent: null, detail: 'HTTP 403' });
    expect(rows[1]).toMatchObject({
      status: 'unlimited',
      used: 5000,
      percent: null,
      detail: 'public repo; 3 runs',
    });
    const none = evaluate(config, [], { 'workers-requests': 'not configured' });
    expect(none.map((r) => [r.status, r.detail])).toEqual([
      ['not-collected', 'not configured'],
      ['not-collected', 'no collector'],
    ]);
    const nan = evaluate(config, [{ id: 'workers-requests', value: Number.NaN }]);
    expect(nan[0]).toMatchObject({ used: 0, percent: 0, status: 'ok' });
  });
});

describe('formatNumber', () => {
  it('formats integers, decimals and non-finite values', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(0.0123456)).toBe('0.012');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatReport', () => {
  const generatedAt = new Date('2026-10-01T03:37:12Z');
  it('renders a table with an alert summary, LLM totals and sources', () => {
    const rows = evaluate(config, [
      { id: 'workers-requests', value: 80000, peakDate: '2026-09-12', detail: 'a|b' },
      { id: 'github-actions-minutes', value: 100 },
    ]);
    const md = formatReport({
      period,
      rows,
      threshold: 70,
      generatedAt,
      runUrl: 'https://github.com/o/r/actions/runs/1',
      llm: {
        agents: [
          { agent: 'builder', calls: 2, prompt: 1000, completion: 200 },
          { agent: 'qa', calls: 1, prompt: 10, completion: 5 },
        ],
        files: 2,
        undated: 1,
        malformed: 2,
      },
    });
    expect(md).toMatchInlineSnapshot(`
      "# Free-tier usage — 2026-09

      Period: 2026-09-01 to 2026-09-30 (UTC). Generated 2026-10-01 03:37 UTC by \`scripts/usage\` ([run](https://github.com/o/r/actions/runs/1)).

      **1 limit(s) at or above 70%:** Cloudflare Workers — Requests.

      | Service | Metric | Window | Used | Free limit | % used | Status | Notes |
      | --- | --- | --- | --: | --: | --: | --- | --- |
      | Cloudflare Workers | Requests | busiest day | 80,000 requests | 100,000 requests | 80% | **ALERT** | peak day 2026-09-12; a\\|b |
      | GitHub Actions | Minutes | month | 100 min | 2,000 min | 5% | ok |  |

      ## Agent LLM tokens

      | Agent | Calls | Prompt tokens | Completion tokens | Total |
      | --- | --: | --: | --: | --: |
      | builder | 2 | 1,000 | 200 | 1,200 |
      | qa | 1 | 10 | 5 | 15 |
      | **Total** | 3 | 1,010 | 205 | 1,215 |

      Provider free tiers limit requests/tokens per model per minute/day; budgets are enforced by \`agents/lib\` at run time, so this table is for trend-watching only.

      Skipped log lines: 1 without a date, 2 unreadable.

      ## Sources

      Limits come from \`data/free-tier-limits.json\` (mirrors \`docs/COSTS.md\`). Daily limits are compared with the busiest day of the period.

      - Cloudflare Workers: <https://example.com/workers> (last verified 2026-09-29)
      - GitHub Actions: <https://example.com/gh> (last verified 2026-09-29)
      "
    `);
  });

  it('says so when nothing is over and nothing was logged; marks month to date', () => {
    const p = resolvePeriod('current', new Date('2026-10-06T00:00:00Z'));
    const rows = evaluate(config, [], {});
    const md = formatReport({ period: p, rows, threshold: 70, generatedAt, llm: null });
    expect(md).toContain('**month to date**');
    expect(md).toContain('No limit at or above 70%.');
    expect(md).toContain('No LLM calls logged in this period.');
    expect(md).toContain('| — | 100,000 requests | — | not collected | no collector |');
    const md2 = formatReport({
      period: p,
      rows: evaluate(config, [{ id: 'github-actions-minutes', value: 1, unlimited: 'public' }]),
      threshold: 70,
      generatedAt,
      llm: { agents: [], files: 1, undated: 0, malformed: 0 },
      llmNote: 'custom note',
    });
    expect(md2).toContain('custom note');
    expect(md2).toContain('| no limit | public |');
    expect(md2).not.toContain('[run]');
  });
});

describe('buildUsageAlert', () => {
  it('is null when nothing is at the threshold', () => {
    const rows = evaluate(config, [{ id: 'github-actions-minutes', value: 1 }]);
    expect(buildUsageAlert({ period, rows, threshold: 70, reportPath: 'r.md' })).toBeNull();
  });
  it('lists every alerting limit with labels for the owner queue', () => {
    const rows = evaluate(config, [
      { id: 'workers-requests', value: 90000, peakDate: '2026-09-12' },
      { id: 'github-actions-minutes', value: 1500 },
    ]);
    const a = buildUsageAlert({
      period,
      rows,
      threshold: 70,
      reportPath: 'company/reports/usage/2026-09.md',
    });
    expect(a?.labels).toEqual(['needs-owner', 'type:infra', 'type:alert']);
    expect(a?.title).toBe('Free-tier usage at or above 70%');
    expect(a?.body).toContain(
      '- **Cloudflare Workers — Requests**: 90,000 of 100,000 requests (90% of the daily free limit; peak day 2026-09-12)',
    );
    expect(a?.body).toContain(
      '- **GitHub Actions — Minutes**: 1,500 of 2,000 min (75% of the monthly free limit)',
    );
    expect(a?.body).toContain('Full report: `company/reports/usage/2026-09.md`.');
    expect(a?.comment).toMatch(/^Usage check for 2026-09:/);

    const partial = resolvePeriod('current', new Date('2026-10-06T00:00:00Z'));
    const b = buildUsageAlert({
      period: partial,
      rows,
      threshold: 70,
      reportPath: 'x.md',
      runUrl: 'https://github.com/o/r/actions/runs/9',
    });
    expect(b?.body).toContain('(month to date)');
    expect(b?.body).toContain('[the run summary](https://github.com/o/r/actions/runs/9)');
    expect(b?.comment).toContain('(month to date)');
  });
});
