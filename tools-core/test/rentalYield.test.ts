import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeRentalYield,
  RENTAL_YIELD_LIMITS,
  type RentalYieldInput,
  type RentalYieldResult,
} from '../src/index.js';

interface Case {
  name: string;
  input: RentalYieldInput;
  expect: Partial<Record<keyof RentalYieldResult, number>>;
  tolerance?: { percent: number };
  sources: string[];
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/rental-yield-known-answers.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

describe('rental yield known answers (published examples)', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(c.sources.length).toBeGreaterThan(0);
    const r = computeRentalYield(c.input);
    for (const [k, v] of Object.entries(c.expect)) {
      const got = r[k as keyof RentalYieldResult];
      expect(Math.abs(got - v), k).toBeLessThanOrEqual(c.tolerance?.percent ?? 1e-9);
    }
  });
});

describe('computeRentalYield', () => {
  const base: RentalYieldInput = { propertyValue: 8000000, monthlyRent: 25000 };

  it('defaults to no vacancy, no costs and no purchase costs', () => {
    const r = computeRentalYield(base);
    expect(r).toEqual({
      investment: 8000000,
      annualRent: 300000,
      collectedRent: 300000,
      netIncome: 300000,
      grossYieldPercent: 3.75,
      netYieldPercent: 3.75,
      yearsOfRent: 8000000 / 300000,
    });
  });

  it('adds purchase costs to the money put in', () => {
    const r = computeRentalYield({ ...base, purchaseCosts: 600000, vacancyMonths: 1 });
    expect(r.investment).toBe(8600000);
    expect(r.collectedRent).toBe(275000);
    expect(r.grossYieldPercent).toBeCloseTo((300000 / 8600000) * 100, 12);
    expect(r.netYieldPercent).toBeCloseTo((275000 / 8600000) * 100, 12);
  });

  it('net income can be negative when costs exceed rent', () => {
    const r = computeRentalYield({ ...base, yearlyCosts: 400000 });
    expect(r.netIncome).toBe(-100000);
    expect(r.netYieldPercent).toBeCloseTo(-1.25, 12);
  });

  it('a whole year empty collects nothing', () => {
    expect(computeRentalYield({ ...base, vacancyMonths: 12 }).collectedRent).toBe(0);
  });

  it('rejects inputs out of range', () => {
    const bad: Array<Partial<RentalYieldInput>> = [
      { propertyValue: 0 },
      { propertyValue: RENTAL_YIELD_LIMITS.maxAmount + 1 },
      { monthlyRent: 0 },
      { monthlyRent: Number.NaN },
      { purchaseCosts: -1 },
      { yearlyCosts: -1 },
      { yearlyCosts: Number.POSITIVE_INFINITY },
      { vacancyMonths: -0.5 },
      { vacancyMonths: 12.5 },
    ];
    for (const b of bad) expect(() => computeRentalYield({ ...base, ...b })).toThrow(RangeError);
  });
});
