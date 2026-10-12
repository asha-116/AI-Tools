import { describe, expect, it } from 'vitest';
import {
  checkCountRows,
  COUNT_QUERY,
  GOAL,
  missingCloudflare,
  reportMarkdown,
  wranglerConfig,
} from '../waitlist-report.mjs';

const ideas = [
  { id: 'stamp-duty', title: { en: 'Stamp duty calculator' } },
  { id: 'lead-tracker', title: { en: 'Lead tracker' } },
];

describe('waitlist report', () => {
  it('only counts: the query never selects the email column', () => {
    expect(COUNT_QUERY).toMatch(/COUNT\(\*\)/);
    expect(COUNT_QUERY.toLowerCase()).not.toContain('email');
  });

  it('accepts idea/lang/count rows and refuses anything else', () => {
    expect(checkCountRows([{ idea: 'lead-tracker', lang: 'hi', n: 3 }])).toEqual([
      { idea: 'lead-tracker', lang: 'hi', n: 3 },
    ]);
    expect(() => checkCountRows([{ idea: 'x', lang: 'en', n: 1, email: 'a@b.in' }])).toThrow(
      'unexpected columns',
    );
    expect(() => checkCountRows([{ idea: 'a@b.in', lang: 'en', n: 1 }])).toThrow('not an id');
    expect(() => checkCountRows([{ idea: 'x', lang: 'fr', n: 1 }])).toThrow('en/hi');
    expect(() => checkCountRows([{ idea: 'x', lang: 'en', n: 1.5 }])).toThrow('whole number');
    expect(() => checkCountRows([{ idea: 'x', lang: 'en', n: '2' }])).toThrow('whole number');
  });

  it('builds a table per idea with totals and progress to the goal', () => {
    const md = reportMarkdown(
      [
        { idea: 'lead-tracker', lang: 'en', n: 4 },
        { idea: 'lead-tracker', lang: 'hi', n: 2 },
        { idea: 'stamp-duty', lang: 'en', n: 1 },
        { idea: 'old-idea', lang: 'en', n: 1 },
      ],
      ideas,
      '2026-10-12',
    );
    expect(md).toContain('### Waitlist sign-ups — 2026-10-12');
    expect(md).toContain(`**8 of ${String(GOAL)}**`);
    expect(md).not.toContain('goal reached');
    // Most sign-ups first; ideas no longer listed are still counted and named.
    const rows = md
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Idea') && !l.startsWith('| ---'));
    expect(rows[0]).toBe('| Lead tracker | 4 | 2 | 6 |');
    expect(md).toContain('| old-idea (not in waitlist-ideas.json) | 1 | 0 | 1 |');
    expect(md).toContain('| Stamp duty calculator | 1 | 0 | 1 |');
  });

  it('shows zero rows for ideas without sign-ups and marks the goal when reached', () => {
    expect(reportMarkdown([], ideas, 'd')).toContain('| Lead tracker | 0 | 0 | 0 |');
    const md = reportMarkdown([{ idea: 'stamp-duty', lang: 'en', n: GOAL }], ideas, 'd');
    expect(md).toContain('goal reached');
  });

  it('writes a wrangler config only for a UUID and lists missing settings', () => {
    expect(wranglerConfig('12345678-1234-1234-1234-123456789abc')).toContain(
      'database_name = "toolshop-waitlist"',
    );
    expect(() => wranglerConfig('nope')).toThrow('UUID');
    expect(missingCloudflare({ CLOUDFLARE_API_TOKEN: 't' })).toEqual([
      'CLOUDFLARE_ACCOUNT_ID',
      'WAITLIST_D1_ID',
    ]);
  });
});
