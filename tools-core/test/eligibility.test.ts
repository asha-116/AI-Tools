import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeEligibility,
  computeEmi,
  ELIGIBILITY_LIMITS,
  type EligibilityInput,
} from '../src/index.js';

interface Case {
  name: string;
  input: EligibilityInput;
  expect: { availableEmi: number; maxLoan: number };
  tolerance: { maxLoanPercent: number };
  sources: string[];
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/eligibility-known-answers.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

describe('eligibility known answers (published examples)', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(c.sources.length).toBeGreaterThan(0);
    const r = computeEligibility(c.input);
    expect(r.availableEmi).toBe(c.expect.availableEmi);
    const rel = Math.abs(r.maxLoan - c.expect.maxLoan) / c.expect.maxLoan;
    expect(rel * 100).toBeLessThanOrEqual(c.tolerance.maxLoanPercent);
  });
});

const base: EligibilityInput = {
  monthlyIncome: 100000,
  existingEmis: 10000,
  foirPercent: 50,
  annualRatePercent: 9,
  tenureMonths: 240,
};

describe('computeEligibility', () => {
  it('is the present value of the available EMI (closed form)', () => {
    const r = computeEligibility(base);
    const m = 9 / 1200;
    expect(r.maxTotalEmi).toBe(50000);
    expect(r.availableEmi).toBe(40000);
    expect(r.maxLoan).toBeCloseTo((40000 * (1 - (1 + m) ** -240)) / m, 6);
  });

  it('round-trips: the EMI on the maximum loan is the available EMI', () => {
    for (const [rate, n] of [
      [6.5, 360],
      [8.5, 240],
      [12, 60],
      [0.01, 12],
    ] as const) {
      const r = computeEligibility({ ...base, annualRatePercent: rate, tenureMonths: n });
      const back = computeEmi({ principal: r.maxLoan, annualRatePercent: rate, tenureMonths: n });
      expect(back.emi).toBeCloseTo(r.availableEmi, 6);
    }
  });

  it('at 0% the loan is EMI × months', () => {
    expect(computeEligibility({ ...base, annualRatePercent: 0 }).maxLoan).toBe(40000 * 240);
  });

  it('gives 0 when existing EMIs already use up the FOIR limit', () => {
    for (const existingEmis of [50000, 70000]) {
      const r = computeEligibility({ ...base, existingEmis });
      expect(r.availableEmi).toBe(0);
      expect(r.maxLoan).toBe(0);
    }
  });

  it('counts existing EMIs in the FOIR now in use', () => {
    expect(computeEligibility(base).currentFoirPercent).toBe(10);
    expect(computeEligibility({ ...base, existingEmis: 0 }).currentFoirPercent).toBe(0);
  });

  it('shows the down payment for a property price (never negative)', () => {
    const r = computeEligibility({ ...base, propertyPrice: 8000000 });
    expect(r.downPayment).toBeCloseTo(8000000 - r.maxLoan, 6);
    expect(computeEligibility({ ...base, propertyPrice: 1000000 }).downPayment).toBe(0);
    expect(computeEligibility(base).downPayment).toBeUndefined();
  });

  it('rejects inputs out of range', () => {
    const bad: Array<Partial<EligibilityInput>> = [
      { monthlyIncome: 0 },
      { monthlyIncome: ELIGIBILITY_LIMITS.maxAmount + 1 },
      { monthlyIncome: Number.NaN },
      { existingEmis: -1 },
      { existingEmis: ELIGIBILITY_LIMITS.maxAmount + 1 },
      { foirPercent: 0 },
      { foirPercent: 101 },
      { annualRatePercent: -1 },
      { annualRatePercent: 51 },
      { tenureMonths: 0 },
      { tenureMonths: 12.5 },
      { tenureMonths: 481 },
      { propertyPrice: -1 },
      { propertyPrice: Number.POSITIVE_INFINITY },
    ];
    for (const b of bad) expect(() => computeEligibility({ ...base, ...b })).toThrow();
  });
});
