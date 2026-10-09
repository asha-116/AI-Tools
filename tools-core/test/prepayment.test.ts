import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeEmi,
  computePrepayment,
  PREPAYMENT_LIMITS,
  type PrepaymentInput,
} from '../src/index.js';

interface Case {
  name: string;
  input: PrepaymentInput;
  expect: { emi?: number; months: number; totalInterest: number };
  tolerance: { emi?: number; months: number; totalInterestPercent: number };
  sources: string[];
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/prepayment-known-answers.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

describe('prepayment known answers (published examples, rounded)', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(c.sources.length).toBeGreaterThan(0);
    const r = computePrepayment(c.input);
    if (c.expect.emi !== undefined) {
      expect(Math.abs(r.emi - c.expect.emi)).toBeLessThanOrEqual(c.tolerance.emi ?? 0);
    }
    expect(Math.abs(r.withPrepayment.months - c.expect.months)).toBeLessThanOrEqual(
      c.tolerance.months,
    );
    const rel =
      Math.abs(r.withPrepayment.totalInterest - c.expect.totalInterest) / c.expect.totalInterest;
    expect(rel * 100).toBeLessThanOrEqual(c.tolerance.totalInterestPercent);
  });
});

/** Closed forms (https://en.wikipedia.org/wiki/Mortgage_calculator). */
const balanceAfter = (P: number, r: number, A: number, k: number) =>
  P * (1 + r) ** k - (A * ((1 + r) ** k - 1)) / r;
const paymentsNeeded = (P: number, r: number, A: number) =>
  -Math.log(1 - (r * P) / A) / Math.log(1 + r);

describe('computePrepayment against the closed-form formulas', () => {
  it('without prepayment equals the plain EMI schedule, to the paisa', () => {
    const input = { principal: 3500000, annualRatePercent: 8.65, tenureMonths: 360 };
    const r = computePrepayment(input);
    const e = computeEmi(input);
    expect(r.emi).toBeCloseTo(e.emi, 8);
    expect(r.baseline.months).toBe(360);
    expect(r.baseline.totalInterest).toBeCloseTo(e.totalInterest, 2);
    expect(r.withPrepayment).toEqual(r.baseline);
    expect(r.interestSaved).toBe(0);
    expect(r.monthsSaved).toBe(0);
  });

  it('a lump sum after month k shortens the loan to the closed-form number of payments', () => {
    const P = 4000000;
    const rate = 8.5;
    const n = 240;
    const k = 36;
    const lump = 500000;
    const r = computePrepayment({
      principal: P,
      annualRatePercent: rate,
      tenureMonths: n,
      lumpSums: [{ month: k, amount: lump }],
    });
    const m = rate / 1200;
    const left = balanceAfter(P, m, r.emi, k) - lump;
    const expected = k + Math.ceil(paymentsNeeded(left, m, r.emi) - 1e-9);
    expect(r.withPrepayment.months).toBe(expected);
    expect(r.withPrepayment.totalPrepaid).toBe(lump);
    // Total paid = EMIs (last one partial) + prepayment; interest = total paid − principal.
    expect(r.withPrepayment.totalInterest).toBeCloseTo(r.withPrepayment.totalPaid - P, 2);
    expect(r.interestSaved).toBeCloseTo(
      r.baseline.totalInterest - r.withPrepayment.totalInterest,
      6,
    );
    expect(r.monthsSaved).toBe(n - expected);
  });

  it('a monthly extra works like a bigger EMI (closed form)', () => {
    const P = 2000000;
    const rate = 9;
    const r = computePrepayment({
      principal: P,
      annualRatePercent: rate,
      tenureMonths: 240,
      monthlyExtra: 5000,
    });
    const expected = Math.ceil(paymentsNeeded(P, rate / 1200, r.emi + 5000) - 1e-9);
    expect(r.withPrepayment.months).toBe(expected);
  });

  it('a prepayment bigger than the balance closes the loan without overpaying', () => {
    const r = computePrepayment({
      principal: 1000000,
      annualRatePercent: 10,
      tenureMonths: 120,
      lumpSums: [{ month: 12, amount: 5000000 }],
    });
    expect(r.withPrepayment.months).toBe(12);
    expect(r.withPrepayment.totalPrepaid).toBeLessThan(1000000);
    expect(r.withPrepayment.totalPaid - 1000000).toBeCloseTo(r.withPrepayment.totalInterest, 6);
  });

  it('handles a 0% loan', () => {
    const r = computePrepayment({
      principal: 120000,
      annualRatePercent: 0,
      tenureMonths: 12,
      lumpSums: [{ month: 0, amount: 60000 }],
    });
    expect(r.emi).toBe(10000);
    expect(r.withPrepayment.months).toBe(6);
    expect(r.withPrepayment.totalInterest).toBeCloseTo(0, 9);
  });

  it('rejects bad input', () => {
    const base = { principal: 1000000, annualRatePercent: 9, tenureMonths: 120 };
    expect(() => computePrepayment({ ...base, monthlyExtra: -1 })).toThrow(RangeError);
    expect(() => computePrepayment({ ...base, yearlyExtra: Number.NaN })).toThrow();
    expect(() => computePrepayment({ ...base, lumpSums: [{ month: 121, amount: 1 }] })).toThrow(
      RangeError,
    );
    expect(() => computePrepayment({ ...base, lumpSums: [{ month: 1.5, amount: 1 }] })).toThrow(
      RangeError,
    );
    expect(() => computePrepayment({ ...base, lumpSums: [{ month: 1, amount: -5 }] })).toThrow(
      RangeError,
    );
    expect(() =>
      computePrepayment({
        ...base,
        lumpSums: Array.from({ length: PREPAYMENT_LIMITS.maxLumpSums + 1 }, () => ({
          month: 1,
          amount: 1,
        })),
      }),
    ).toThrow(RangeError);
    expect(() =>
      computePrepayment({ ...base, monthlyExtra: PREPAYMENT_LIMITS.maxAmount + 1 }),
    ).toThrow(RangeError);
  });
});
