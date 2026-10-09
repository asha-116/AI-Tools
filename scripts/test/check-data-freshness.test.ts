import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ageInDays,
  checkFreshness,
  lastVerifiedDates,
  MAX_AGE_DAYS,
  readDataDocs,
} from '../check-data-freshness.mjs';

const today = '2026-10-09';

describe('ageInDays', () => {
  it('counts whole days and rejects impossible dates', () => {
    expect(ageInDays('2026-10-09', today)).toBe(0);
    expect(ageInDays('2026-04-12', today)).toBe(180);
    expect(ageInDays('2026-10-10', today)).toBe(-1);
    expect(ageInDays('2026-02-30', today)).toBeNull();
    expect(ageInDays('09-10-2026', today)).toBeNull();
  });
});

describe('lastVerifiedDates', () => {
  it('finds dates at any depth', () => {
    expect(
      lastVerifiedDates({ last_verified: 'a', rules: [{ x: { last_verified: 'b' } }], n: 1 }),
    ).toEqual(['a', 'b']);
    expect(lastVerifiedDates('x')).toEqual([]);
  });
});

describe('checkFreshness', () => {
  const doc = (last_verified: string, status = 'verified') => ({ status, last_verified });

  it('passes fresh files and files without dates', () => {
    expect(
      checkFreshness(
        [
          { path: 'a.json', doc: doc('2026-09-29') },
          { path: 'b.json', doc: { ideas: [] } },
        ],
        today,
      ),
    ).toEqual([]);
  });

  it('fails a verified file past the limit, but only warns for a draft', () => {
    const old = '2026-04-11'; // 181 days
    expect(checkFreshness([{ path: 'v.json', doc: doc(old) }], today)).toEqual([
      expect.objectContaining({ level: 'error', path: 'v.json' }),
    ]);
    expect(checkFreshness([{ path: 'd.json', doc: doc(old, 'draft') }], today)).toEqual([
      expect.objectContaining({ level: 'warning', path: 'd.json' }),
    ]);
    expect(checkFreshness([{ path: 'v.json', doc: doc('2026-04-12') }], today)[0]?.level).toBe(
      'warning',
    ); // exactly at the limit: still allowed, but due
  });

  it('warns 30 days ahead and uses the oldest date in the file', () => {
    const r = checkFreshness(
      [
        {
          path: 'm.json',
          doc: {
            status: 'verified',
            last_verified: '2026-10-01',
            rules: [{ last_verified: '2026-05-01' }],
          },
        },
      ],
      today,
    );
    expect(r).toEqual([
      { level: 'warning', path: 'm.json', message: expect.stringMatching(/within 19 days/) },
    ]);
    expect(MAX_AGE_DAYS).toBe(180);
  });

  it('rejects malformed and future dates', () => {
    const r = checkFreshness(
      [
        {
          path: 'x.json',
          doc: { last_verified: '2026-13-01', more: { last_verified: '2027-01-01' } },
        },
      ],
      today,
    );
    expect(r.map((f) => [f.level, f.message.includes('future')])).toEqual([
      ['error', false],
      ['error', true],
    ]);
  });
});

describe('readDataDocs', () => {
  it('reads data/**/*.json and skips JSON Schema files', () => {
    const root = mkdtempSync(join(tmpdir(), 'fresh-'));
    mkdirSync(join(root, 'data/stamp-duty'), { recursive: true });
    writeFileSync(join(root, 'data/a.json'), '{"x":1}');
    writeFileSync(join(root, 'data/stamp-duty/KA.json'), '{"last_verified":"2026-09-29"}');
    writeFileSync(join(root, 'data/stamp-duty/schema.json'), '{}');
    writeFileSync(join(root, 'data/stamp-duty/README.md'), '#');
    expect(readDataDocs(root).map((d) => d.path)).toEqual([
      'data/a.json',
      'data/stamp-duty/KA.json',
    ]);
  });
});
