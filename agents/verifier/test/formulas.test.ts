import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORMULAS,
  allocate,
  loadCases,
  mulberry32,
  numericLeaves,
  runOurs,
  sampleCases,
  selectEntries,
  withinTolerance,
} from '../src/formulas.js';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8');
const entry = (id: string) => {
  const e = FORMULAS.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e;
};

describe('withinTolerance (PROCEDURE: ₹1 or 0.01%, whichever is larger)', () => {
  it('accepts up to ₹1 on small amounts', () => {
    expect(withinTolerance(13493.0, 13493.99)).toBe(true);
    expect(withinTolerance(100, 101)).toBe(true);
    expect(withinTolerance(100, 101.01)).toBe(false);
  });
  it('accepts up to 0.01% on large amounts', () => {
    // 0.01% of ₹6,19,22,000 is ₹6,192.20
    expect(withinTolerance(61_922_000 + 6_000, 61_922_000)).toBe(true);
    expect(withinTolerance(61_922_000 + 6_300, 61_922_000)).toBe(false);
  });
  it('rejects non-finite numbers', () => {
    expect(withinTolerance(Number.NaN, 1)).toBe(false);
    expect(withinTolerance(1, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('selectEntries', () => {
  it('maps source and fixture files to registry entries', () => {
    const r = selectEntries(['tools-core/src/emi.ts']);
    expect(r.entries.map((e) => e.id)).toEqual(['emi']);
    expect(r.unregistered).toEqual([]);
    expect(
      selectEntries(['tools-core/test/fixtures/commission-known-answers.json']).entries.map(
        (e) => e.id,
      ),
    ).toEqual(['commission']);
  });
  it('shared helpers re-check every registered formula', () => {
    expect(selectEntries(['tools-core/src/numbers.ts']).entries.map((e) => e.id)).toEqual([
      'emi',
      'commission',
      'prepayment',
      'eligibility',
      'loading',
      'rental-yield',
      'rent-vs-buy',
      'balance-transfer',
      'area',
    ]);
  });
  it('reports formula files without a registered known-answer fixture', () => {
    const r = selectEntries(['tools-core/src/stampDuty.ts', 'tools-core/src/emi.ts']);
    expect(r.entries.map((e) => e.id)).toEqual(['emi']);
    expect(r.unregistered).toEqual(['tools-core/src/stampDuty.ts']);
  });
});

describe('loadCases', () => {
  it('reads the EMI fixture into inputs only (never the expected answers)', () => {
    const cases = loadCases(entry('emi'), read);
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(cases[0]).toEqual({
      id: 'emi-1',
      input: { principal: 1000000, annualRatePercent: 10.5, tenureMonths: 120 },
      sources: expect.arrayContaining(['https://emicalculator.net/']),
    });
  });
  it('reads the commission fixture inputs', () => {
    const cases = loadCases(entry('commission'), read);
    expect(cases[0]?.input).toMatchObject({ dealValue: 10000000, gstPercent: 18 });
    expect(cases[0]?.input).not.toHaveProperty('expect');
  });
  it('tolerates a fixture without sources or cases', () => {
    expect(
      loadCases(
        entry('emi'),
        () => '{"cases":[{"principal":1,"annualRatePercent":0,"tenureMonths":1}]}',
      )[0]?.sources,
    ).toEqual([]);
    expect(loadCases(entry('emi'), () => '{}')).toEqual([]);
  });
});

describe('runOurs — our functions on cited known answers', () => {
  it('EMI ₹10,00,000 at 10.5% for 120 months → ₹13,493 (fixture case 1)', () => {
    const r = runOurs(entry('emi'), {
      principal: 1000000,
      annualRatePercent: 10.5,
      tenureMonths: 120,
    });
    expect('values' in r && Math.round(r.values.emi as number)).toBe(13493);
    expect('values' in r && Math.round(r.values.totalInterest as number)).toBe(619220);
    expect(entry('emi').fields({})).toEqual(['emi', 'totalPayment', 'totalInterest']);
  });
  it('commission ₹1 crore at 2% + 18% GST → ₹2,36,000, split by party', () => {
    const input = {
      dealValue: 10000000,
      commission: { type: 'percent', percent: 2 },
      gstPercent: 18,
      parties: [
        { label: 'A', percent: 70 },
        { label: 'B', percent: 30 },
      ],
    };
    expect(runOurs(entry('commission'), input)).toEqual({
      values: { gross: 200000, gst: 36000, totalPayable: 236000, party_1: 140000, party_2: 60000 },
    });
    expect(entry('commission').fields(input)).toEqual([
      'gross',
      'gst',
      'totalPayable',
      'party_1',
      'party_2',
    ]);
    expect(entry('commission').fields({})).toEqual(['gross', 'gst', 'totalPayable']);
  });
  it('returns the error when our function throws', () => {
    expect(runOurs(entry('emi'), { principal: -1, annualRatePercent: 1, tenureMonths: 1 })).toEqual(
      {
        error: expect.stringContaining('principal'),
      },
    );
    const boom = {
      ...entry('emi'),
      run: () => {
        throw 'x';
      },
    };
    expect(runOurs(boom, {})).toEqual({ error: 'x' });
  });
});

describe('sampling', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(12);
    const b = mulberry32(12);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(13)()).not.toBe(mulberry32(12)());
  });

  it('numericLeaves flattens nested numbers', () => {
    expect(numericLeaves({ a: 1, b: { c: 2, d: [3, { e: 4 }] }, s: 'x' })).toEqual({
      a: 1,
      'b.c': 2,
      'b.d.0': 3,
      'b.d.1.e': 4,
    });
  });

  it('takes edge cases (min/max of each input) first, then seeded typical ones', () => {
    const cases = Array.from({ length: 20 }, (_, i) => ({
      id: `c${String(i)}`,
      input: { x: i === 7 ? -5 : i, y: i === 3 ? 100 : 1 },
      sources: [],
    }));
    const s = sampleCases(cases, 6, 42);
    expect(s).toHaveLength(6);
    expect(s.slice(0, 3).map((c) => c.id)).toEqual(['c0', 'c3', 'c7']);
    expect(new Set(s.map((c) => c.id)).size).toBe(6);
    expect(sampleCases(cases, 6, 42)).toEqual(s);
  });

  it('returns everything when there are fewer cases than asked', () => {
    const cases = [{ id: 'a', input: { x: 1 }, sources: [] }];
    expect(sampleCases(cases, 10, 1)).toEqual(cases);
    expect(sampleCases(cases, 0, 1)).toEqual([]);
  });

  it('fills from edge cases when there are no typical ones left', () => {
    const cases = Array.from({ length: 4 }, (_, i) => ({
      id: String(i),
      input: { x: i, y: 3 - i },
      sources: [],
    }));
    expect(sampleCases(cases, 3, 1)).toHaveLength(3);
  });

  it('allocate splits a total across entries, earlier ones first', () => {
    expect(allocate(10, 1)).toEqual([10]);
    expect(allocate(10, 3)).toEqual([4, 3, 3]);
    expect(allocate(10, 0)).toEqual([]);
  });
});

describe('area entry', () => {
  it('maps the area source, data and fixture files, and our run reproduces every known answer', () => {
    expect(selectEntries(['tools-core/src/area.ts']).entries.map((e) => e.id)).toEqual(['area']);
    expect(selectEntries(['data/land-units/regional.json']).entries.map((e) => e.id)).toEqual([
      'area',
    ]);
    const e = entry('area');
    const doc = JSON.parse(read(e.fixture)) as { cases: Array<Record<string, unknown>> };
    const cases = loadCases(e, read);
    expect(cases).toHaveLength(doc.cases.length);
    cases.forEach((c, i) => {
      expect(e.fields(c.input)).toEqual(['result']);
      const ours = runOurs(e, c.input);
      expect('values' in ours && ours.values.result).toBeCloseTo(doc.cases[i]?.expect as number, 6);
    });
    expect(runOurs(e, { value: 1, from: 'acre', to: 'bigha' })).toEqual({
      error: 'unknown area unit bigha',
    });
  });
});

describe('prepayment entry', () => {
  it('asks for months only where a closed form exists, and our run matches the fixture', () => {
    const e = entry('prepayment');
    const cases = loadCases(e, read);
    expect(cases.map((c) => e.fields(c.input))).toEqual([
      ['emi', 'baselineInterest'],
      ['emi', 'baselineInterest', 'months'],
      ['emi', 'baselineInterest'],
    ]);
    const ours = runOurs(e, cases[1]?.input ?? {});
    expect('values' in ours && ours.values.months).toBe(195);
  });
});

describe('eligibility entry', () => {
  it('sends inputs only and our run matches the exact published case', () => {
    const e = entry('eligibility');
    const cases = loadCases(e, read);
    expect(cases).toHaveLength(4);
    expect(e.fields(cases[0]?.input ?? {})).toEqual(['maxTotalEmi', 'availableEmi', 'maxLoan']);
    const ours = runOurs(e, cases[0]?.input ?? {});
    expect('values' in ours && Math.round(ours.values.maxLoan ?? 0)).toBe(5761542);
  });
});

describe('loading entry', () => {
  it('asks for rates only when a total price is given; our run matches the published rate', () => {
    const e = entry('loading');
    const cases = loadCases(e, read);
    expect(cases.map((c) => e.fields(c.input).length)).toEqual([3, 3, 5]);
    const ours = runOurs(e, cases[2]?.input ?? {});
    expect('values' in ours && Math.round(ours.values.ratePerCarpet ?? 0)).toBe(17143);
    const plain = runOurs(e, cases[0]?.input ?? {});
    expect('values' in plain && Object.keys(plain.values)).toHaveLength(3);
  });
});

describe('rental-yield entry', () => {
  it('our run matches the published Pune case (3.33% net)', () => {
    const e = entry('rental-yield');
    const cases = loadCases(e, read);
    expect(cases).toHaveLength(4);
    const ours = runOurs(e, cases[3]?.input ?? {});
    expect('values' in ours && ours.values.netIncome).toBe(200000);
    expect('values' in ours && Math.round((ours.values.netYieldPercent ?? 0) * 100)).toBe(333);
  });
});

describe('rent-vs-buy entry', () => {
  it('checks the closed-form parts; our run matches the published Pune rent total', () => {
    const e = entry('rent-vs-buy');
    const cases = loadCases(e, read);
    expect(cases).toHaveLength(2);
    const ours = runOurs(e, cases[0]?.input ?? {});
    expect('values' in ours && Math.round((ours.values.rentPaid ?? 0) / 1e5)).toBe(149);
    expect('values' in ours && ours.values.emi).toBe(0);
  });
});

describe('balance-transfer entry', () => {
  it('our run matches the published Kotak case (new EMI ₹35,405)', () => {
    const e = entry('balance-transfer');
    const cases = loadCases(e, read);
    expect(cases).toHaveLength(5);
    const ours = runOurs(e, cases[0]?.input ?? {});
    expect('values' in ours && Math.round(ours.values.newEmi ?? 0)).toBe(35405);
    expect('values' in ours && Object.keys(ours.values)).toHaveLength(7);
  });
});
