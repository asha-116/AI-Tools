import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clip,
  latestUsageReport,
  readDataFiles,
  readLatestMemory,
  readRecentReports,
  readTokenUsage,
  repoOverview,
} from '../src/inputs.js';
import { tempRepo } from './helpers.js';

describe('readDataFiles', () => {
  it('collects last_verified from data/**.json and reports unreadable files', () => {
    const root = tempRepo({
      'data/a.json': JSON.stringify({ last_verified: '2026-01-01' }),
      'data/x/b.json': JSON.stringify({ limits: [{ last_verified: '2025-01-01' }] }),
      'data/none.json': '{}',
      'data/readme.md': 'last_verified: no',
      'data/bad.json': '{',
    });
    expect(readDataFiles(root)).toEqual({
      files: [
        { path: 'data/a.json', dates: ['2026-01-01'] },
        { path: 'data/x/b.json', dates: ['2025-01-01'] },
      ],
      unreadable: ['data/bad.json'],
    });
    expect(readDataFiles(tempRepo({}))).toEqual({ files: [], unreadable: [] });
  });

  it('reads the real data folder', () => {
    const real = readDataFiles(join(import.meta.dirname, '..', '..', '..'));
    expect(real.files.some((f) => f.path === 'data/stamp-duty/KA.json')).toBe(true);
    expect(real.unreadable).toEqual([]);
  });
});

describe('clip', () => {
  it('clips long text with a marker', () => {
    expect(clip('short', 10)).toBe('short');
    expect(clip('x'.repeat(50), 20)).toBe(`${'x'.repeat(8)}\n…[clipped]`);
  });
});

describe('readRecentReports', () => {
  it('returns up to N reports before today, newest first', () => {
    const files: Record<string, string> = { 'company/reports/daily/.gitkeep': '' };
    for (let d = 1; d <= 9; d++) files[`company/reports/daily/2026-10-0${d}.md`] = `r${d}`;
    const root = tempRepo(files);
    const out = readRecentReports(root, '2026-10-06', 3);
    expect(out).toEqual([
      { date: '2026-10-05', text: 'r5' },
      { date: '2026-10-04', text: 'r4' },
      { date: '2026-10-03', text: 'r3' },
    ]);
    expect(readRecentReports(root, '2026-10-06')).toHaveLength(5);
    expect(readRecentReports(tempRepo({}), '2026-10-06')).toEqual([]);
  });
});

describe('readLatestMemory', () => {
  it('reads the newest YYYY-MM.md', () => {
    const root = tempRepo({
      'company/memory/README.md': 'readme',
      'company/memory/2026-09.md': 'sep',
      'company/memory/2026-10.md': 'oct',
    });
    expect(readLatestMemory(root)).toEqual({ file: 'company/memory/2026-10.md', text: 'oct' });
    expect(readLatestMemory(tempRepo({ 'company/memory/README.md': 'x' }))).toBeNull();
    expect(readLatestMemory(tempRepo({}))).toBeNull();
  });
});

describe('readTokenUsage / latestUsageReport', () => {
  it('sums run.end tokens per agent for a date', () => {
    const end = (tokens: number) => JSON.stringify({ event: 'run.end', tokens });
    const root = tempRepo({
      'company/reports/agent-logs/.gitkeep': '',
      'company/reports/agent-logs/builder/2026-10-05.jsonl': `${end(100)}\n${end(50)}\n`,
      'company/reports/agent-logs/qa/2026-10-05.jsonl': `${end(0)}\n`,
      'company/reports/agent-logs/social/2026-10-04.jsonl': `${end(9)}\n`,
    });
    expect(readTokenUsage(root, '2026-10-05')).toEqual([{ agent: 'builder', tokens: 150 }]);
    expect(readTokenUsage(tempRepo({}), '2026-10-05')).toEqual([]);
  });

  it('finds the newest usage report', () => {
    expect(
      latestUsageReport(
        tempRepo({
          'company/reports/usage/2026-08.md': '',
          'company/reports/usage/2026-09.md': '',
          'company/reports/usage/notes.txt': '',
        }),
      ),
    ).toBe('company/reports/usage/2026-09.md');
    expect(latestUsageReport(tempRepo({ 'company/reports/usage/x.txt': '' }))).toBeNull();
    expect(latestUsageReport(tempRepo({}))).toBeNull();
  });
});

describe('repoOverview', () => {
  it('lists the calculators and templates that exist, and the real paths', () => {
    const root = tempRepo({
      'site/src/tools/emi/meta.json': '{}',
      'site/src/tools/commission/meta.json': '{}',
      'products/lead-tracker/spec.json': '{}',
      'products/catalog.json': '{}',
    });
    const o = repoOverview(root);
    expect(o).toContain('Calculators (EN + HI pages): commission, emi');
    expect(o).toContain('Paid templates (shown as "upcoming"): lead-tracker');
    expect(o).toContain('tools-core/test/');
    expect(repoOverview(tempRepo({}))).toContain('Calculators (EN + HI pages): (none)');
  });
});
