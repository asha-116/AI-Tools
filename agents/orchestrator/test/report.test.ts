import { describe, expect, it } from 'vitest';
import { containsPii, type IssueSummary } from '../../lib/src/index.js';
import { clean, renderReport, type ReportInput } from '../src/report.js';
import { toTask } from '../src/tasks.js';
import { candidate } from './helpers.js';

const issue = (n: number, title: string, url = `https://github.com/o/r/issues/${n}`) =>
  ({
    number: n,
    title,
    body: '',
    labels: [],
    state: 'open',
    html_url: url,
    updated_at: '2026-09-01T00:00:00Z',
    is_pull_request: false,
  }) satisfies IssueSummary;

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    date: '2026-10-06',
    yesterday: '2026-10-05',
    dryRun: false,
    merged: [],
    created: [],
    dropped: [],
    stale: [],
    ownerIssues: [],
    waitingPulls: [],
    failing: [],
    staleData: [],
    unreadableData: [],
    llm: { status: 'used', family: 'gemini', candidates: 2 },
    tokens: { run: 1234, perRun: 20_000, daily: 30_000, usedBeforeRun: 0 },
    tokenUsage: [],
    usageReport: null,
    notes: [],
    ...over,
  };
}

describe('clean', () => {
  it('redacts PII and keeps tables intact', () => {
    const out = clean('Call me on +91 98765 43210 | a@b.com\nnext');
    expect(containsPii(out)).toBe(false);
    expect(out).not.toContain('|');
    expect(out).not.toContain('\n');
  });
});

describe('renderReport', () => {
  it('renders an all-quiet day', () => {
    const md = renderReport(input());
    expect(md).toContain('# Daily report — 2026-10-06');
    expect(md).toContain('## Merged yesterday (2026-10-05)\n\n- Nothing merged.');
    expect(md).toContain('## New Issues\n\n- None.');
    expect(md).toContain('## Blockers\n\n- None.');
    expect(md).toContain('This run: 1,234 tokens (per-run limit 20,000; daily limit 30,000');
    expect(md).toContain('No local agent logs for 2026-10-05');
    expect(md).toContain('see the monthly Usage report workflow');
    expect(md).toContain('LLM step ran (model family `gemini`, 2 candidate(s) drafted).');
    expect(md).not.toContain('dry run');
    expect(md).not.toContain('## Notes');
  });

  it('renders a busy dry-run day', () => {
    const task = toTask(candidate({ priority: 'high' }), 'llm');
    const md = renderReport(
      input({
        dryRun: true,
        merged: [issue(7, 'feat: EMI | page')],
        created: [
          { task, result: { dryRun: true, number: 0, html_url: 'dry-run' } },
          { task, result: { dryRun: false, number: 42, html_url: 'https://x/42' } },
          { task, result: { dryRun: false, number: 43, html_url: 'memory://issues/43' } },
        ],
        dropped: [{ title: 'Dup', duplicateOf: '#3 Original' }],
        stale: [{ item: issue(3, 'Old one'), days: 12 }],
        ownerIssues: [issue(4, 'Pick a price')],
        waitingPulls: [
          { number: 8, title: 'PR a', html_url: 'https://x/8', reason: 'needs-owner', days: 1 },
          { number: 9, title: 'PR b', html_url: 'https://x/9', reason: 'no-review', days: 3 },
        ],
        failing: [
          {
            name: 'Deploy',
            path: 'd.yml',
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://x/run',
            created_at: '',
          },
        ],
        staleData: [
          { path: 'data/a.json', last_verified: '2026-01-01', days: 278 },
          { path: 'data/b.json', last_verified: 'soon', days: null },
        ],
        unreadableData: ['data/bad.json'],
        llm: { status: 'skipped', reason: 'no LLM provider configured (no API key set)' },
        tokenUsage: [{ agent: 'builder', tokens: 1500 }],
        usageReport: 'company/reports/usage/2026-09.md',
        notes: ['Could not read open PRs: 403'],
      }),
    );
    expect(md).toContain('**dry run** (nothing was written to GitHub)');
    expect(md).toContain('- [#7](https://github.com/o/r/issues/7) feat: EMI / page');
    expect(md).toContain(
      '- (dry run) Add Hindi FAQ to the EMI page — `agent:builder`, `type:content`, `priority:high`',
    );
    expect(md).toContain('- [#42](https://x/42) Add Hindi FAQ');
    expect(md).toContain('- #43 Add Hindi FAQ');
    expect(md).toContain('- Dup ≈ #3 Original');
    expect(md).toContain('- Failing workflow **Deploy** — [last run](https://x/run)');
    expect(md).toContain('- `data/a.json` last verified 2026-01-01 (278 days ago, limit 180)');
    expect(md).toContain('- `data/b.json` last verified soon (unreadable date)');
    expect(md).toContain('- `data/bad.json` is not valid JSON');
    expect(md).toContain('- LLM step **skipped**: no LLM provider configured (no API key set).');
    expect(md).toContain('- [#4](https://github.com/o/r/issues/4) Pick a price');
    expect(md).toContain('- [#8](https://x/8) PR a — `needs-owner`, 1 day(s)');
    expect(md).toContain('- [#9](https://x/9) PR b — no review, 3 day(s)');
    expect(md).toContain('Old one — 12 days');
    expect(md).toContain('- `builder` on 2026-10-05: 1,500 tokens');
    expect(md).toContain('see `company/reports/usage/2026-09.md`');
    expect(md).toContain('## Notes\n\n- Could not read open PRs: 403');
    expect(md).not.toContain('LLM step ran');
  });

  it('marks unread sections and failed LLM steps', () => {
    const md = renderReport(
      input({
        merged: null,
        stale: null,
        ownerIssues: null,
        waitingPulls: null,
        failing: null,
        llm: { status: 'failed', reason: 'all LLM providers failed' },
      }),
    );
    expect(md.match(/Unavailable this run/g)).toHaveLength(4);
    expect(md).toContain('LLM step **failed**: all LLM providers failed.');
  });
});
