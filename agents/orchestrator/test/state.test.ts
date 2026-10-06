import { describe, expect, it } from 'vitest';
import type { IssueSummary, PullSummary } from '../../lib/src/index.js';
import {
  addDays,
  ageDays,
  failingWorkflows,
  goalsAreEmpty,
  istDate,
  lastVerifiedDates,
  ownerIssues,
  prsWaitingOnOwner,
  staleDataFiles,
  staleIssues,
  type WorkflowRun,
} from '../src/state.js';

const NOW = new Date('2026-10-06T01:00:00Z');

function issue(n: number, updated: string, extra: Partial<IssueSummary> = {}): IssueSummary {
  return {
    number: n,
    title: `Issue ${n}`,
    body: '',
    labels: [],
    state: 'open',
    html_url: `https://github.com/o/r/issues/${n}`,
    updated_at: updated,
    is_pull_request: false,
    ...extra,
  };
}

function pull(n: number, updated: string, labels: string[] = [], state = 'open'): PullSummary {
  return {
    number: n,
    title: `PR ${n}`,
    body: '',
    labels,
    state,
    html_url: `https://github.com/o/r/pull/${n}`,
    head: { ref: `b${n}`, sha: 'x' },
    base: 'main',
    draft: false,
    updated_at: updated,
  };
}

describe('dates', () => {
  it('uses the IST calendar date', () => {
    expect(istDate(new Date('2026-10-05T18:29:00Z'))).toBe('2026-10-05');
    expect(istDate(new Date('2026-10-05T18:30:00Z'))).toBe('2026-10-06');
  });
  it('adds days across months', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('computes whole days, null for junk', () => {
    expect(ageDays('2026-10-04T01:00:00Z', NOW)).toBe(2);
    expect(ageDays('2026-10-04T01:00:01Z', NOW)).toBe(1);
    expect(ageDays('not a date', NOW)).toBeNull();
  });
});

describe('staleIssues', () => {
  it('keeps open Issues idle for more than 7 days, oldest first', () => {
    const out = staleIssues(
      [
        issue(1, '2026-09-28T01:00:00Z'), // exactly 8 days
        issue(2, '2026-09-29T01:00:00Z'), // exactly 7 days → not stale
        issue(3, '2026-09-01T00:00:00Z'),
        issue(4, '2026-09-01T00:00:00Z', { state: 'closed' }),
        issue(5, '2026-09-01T00:00:00Z', { is_pull_request: true }),
        issue(6, 'garbage'),
      ],
      NOW,
    );
    expect(out.map((a) => [a.item.number, a.days])).toEqual([
      [3, 35],
      [1, 8],
    ]);
  });
  it('orders ties by number', () => {
    const out = staleIssues(
      [issue(9, '2026-09-01T00:00:00Z'), issue(2, '2026-09-01T00:00:00Z')],
      NOW,
    );
    expect(out.map((a) => a.item.number)).toEqual([2, 9]);
  });
});

describe('prsWaitingOnOwner', () => {
  it('lists needs-owner PRs and PRs unreviewed for more than 2 days, once each', () => {
    const pulls = [
      pull(10, '2026-10-05T00:00:00Z', ['needs-owner']),
      pull(11, '2026-09-01T00:00:00Z'),
      pull(12, '2026-09-01T00:00:00Z', ['needs-owner'], 'closed'),
      pull(17, 'junk', ['needs-owner']),
    ];
    const unreviewed = [
      issue(10, '2026-09-01T00:00:00Z', { is_pull_request: true }), // already listed
      issue(13, '2026-10-03T00:00:00Z', { is_pull_request: true }), // 3 days
      issue(14, '2026-10-04T01:00:00Z', { is_pull_request: true }), // exactly 2 days → no
      issue(15, '2026-09-01T00:00:00Z', { is_pull_request: true, state: 'closed' }),
      issue(16, 'junk', { is_pull_request: true }),
    ];
    const out = prsWaitingOnOwner(pulls, unreviewed, NOW);
    expect(out.map((p) => [p.number, p.reason, p.days])).toEqual([
      [13, 'no-review', 3],
      [10, 'needs-owner', 1],
      [17, 'needs-owner', 0],
    ]);
  });
});

describe('ownerIssues', () => {
  it('keeps open needs-owner Issues', () => {
    const out = ownerIssues([
      issue(1, NOW.toISOString(), { labels: ['needs-owner'] }),
      issue(2, NOW.toISOString(), { labels: ['needs-owner'], state: 'closed' }),
      issue(3, NOW.toISOString()),
    ]);
    expect(out.map((i) => i.number)).toEqual([1]);
  });
});

describe('failingWorkflows', () => {
  const run = (
    name: string,
    created: string,
    conclusion: string | null,
    status = 'completed',
    path = `.github/workflows/${name}.yml`,
  ): WorkflowRun => ({
    name,
    path,
    status,
    conclusion,
    html_url: `u/${name}/${created}`,
    created_at: created,
  });

  it('reports a workflow only when its latest completed run failed', () => {
    const out = failingWorkflows([
      run('ci', '2026-10-05T00:00:00Z', 'success'),
      run('ci', '2026-10-04T00:00:00Z', 'failure'), // older failure, fixed since
      run('deploy', '2026-10-05T00:00:00Z', 'failure'),
      run('deploy', '2026-10-04T00:00:00Z', 'success'),
      run('backup', '2026-10-05T00:00:00Z', 'timed_out'),
      run('labels', '2026-10-05T00:00:00Z', 'cancelled'),
      run('usage', '2026-10-06T00:00:00Z', null, 'in_progress'),
      run('usage', '2026-10-05T00:00:00Z', 'startup_failure'),
      run('odd', '2026-10-05T00:00:00Z', null),
      run('nameonly', '2026-10-05T00:00:00Z', 'failure', 'completed', ''),
    ]);
    expect(out.map((r) => r.name)).toEqual(['backup', 'deploy', 'nameonly', 'usage']);
    expect(out.find((r) => r.name === 'deploy')?.html_url).toBe('u/deploy/2026-10-05T00:00:00Z');
  });
});

describe('data freshness', () => {
  it('finds last_verified at any depth', () => {
    expect(
      lastVerifiedDates({
        last_verified: '2026-01-01',
        limits: [{ last_verified: '2025-01-01' }, { x: { last_verified: 5 } }],
        s: 'last_verified',
      }),
    ).toEqual(['2026-01-01', '2025-01-01']);
    expect(lastVerifiedDates(null)).toEqual([]);
    expect(lastVerifiedDates('x')).toEqual([]);
    let deep: unknown = { last_verified: 'deep' };
    for (let i = 0; i < 30; i++) deep = { a: deep };
    expect(lastVerifiedDates(deep)).toEqual([]);
  });

  it('flags files whose oldest date is more than 180 days old, or unparsable', () => {
    const out = staleDataFiles(
      [
        { path: 'data/b.json', dates: ['2026-09-29', '2026-03-01'] }, // 219 days
        { path: 'data/a.json', dates: ['2026-04-09'] }, // exactly 180 days → fresh
        { path: 'data/c.json', dates: ['2026-04-08'] }, // 181
        { path: 'data/d.json', dates: ['2026-09-29', 'soon', '2020-01-01'] },
        { path: 'data/e.json', dates: [] },
      ],
      new Date('2026-10-06T00:00:00Z'),
    );
    expect(out).toEqual([
      { path: 'data/b.json', last_verified: '2026-03-01', days: 219 },
      { path: 'data/c.json', last_verified: '2026-04-08', days: 181 },
      { path: 'data/d.json', last_verified: 'soon', days: null },
    ]);
  });
});

describe('goalsAreEmpty', () => {
  it('needs at least one real bullet', () => {
    expect(goalsAreEmpty('# Goals\n\n## This week\n\n- TBD\n- …\n')).toBe(true);
    expect(goalsAreEmpty('')).toBe(true);
    expect(goalsAreEmpty('# Goals\n\n* Ship the EMI page\n')).toBe(false);
  });
});
