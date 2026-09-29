import { describe, expect, it } from 'vitest';
import known from './fixtures/emi-known-answers.json' with { type: 'json' };
import { computeEmi, EMI_LIMITS } from '../src/index.js';

describe('computeEmi — published known answers', () => {
  it('has at least 10 sourced cases', () => {
    expect(known.cases.length).toBeGreaterThanOrEqual(10);
    for (const c of known.cases) {
      expect(c.sources.length).toBeGreaterThan(0);
      for (const url of c.sources) expect(url).toMatch(/^https:\/\//);
    }
  });

  it.each(known.cases)(
    '₹$principal at $annualRatePercent% for $tenureMonths months → EMI ₹$emi',
    ({ principal, annualRatePercent, tenureMonths, emi, ...rest }) => {
      const r = computeEmi({ principal, annualRatePercent, tenureMonths });
      expect(Math.round(r.emi)).toBe(emi);
      if ('totalInterest' in rest) expect(Math.round(r.totalInterest)).toBe(rest.totalInterest);
    },
  );
});

describe('computeEmi — identities', () => {
  it('total payment = EMI × months and total interest = total payment − principal', () => {
    const r = computeEmi({ principal: 2500000, annualRatePercent: 8.75, tenureMonths: 180 });
    expect(r.totalPayment).toBeCloseTo(r.emi * 180, 6);
    expect(r.totalInterest).toBeCloseTo(r.totalPayment - 2500000, 6);
  });

  it('the schedule pays the loan off exactly (reducing balance)', () => {
    const input = { principal: 3500000, annualRatePercent: 8.65, tenureMonths: 360 };
    const { emi } = computeEmi(input);
    const r = input.annualRatePercent / 1200;
    let balance = input.principal;
    for (let m = 0; m < input.tenureMonths; m++) balance = balance * (1 + r) - emi;
    expect(Math.abs(balance)).toBeLessThan(1e-4);
  });

  it('0% interest: EMI is principal ÷ months, no interest', () => {
    const r = computeEmi({ principal: 120000, annualRatePercent: 0, tenureMonths: 12 });
    expect(r.emi).toBe(10000);
    expect(r.totalInterest).toBe(0);
  });

  it('a single-month loan repays principal plus one month of interest', () => {
    const r = computeEmi({ principal: 100000, annualRatePercent: 12, tenureMonths: 1 });
    expect(r.emi).toBeCloseTo(101000, 6);
  });

  it('EMI rises with rate and falls with tenure', () => {
    const base = { principal: 1000000, annualRatePercent: 9, tenureMonths: 240 };
    expect(computeEmi({ ...base, annualRatePercent: 10 }).emi).toBeGreaterThan(
      computeEmi(base).emi,
    );
    expect(computeEmi({ ...base, tenureMonths: 300 }).emi).toBeLessThan(computeEmi(base).emi);
  });

  it('first month splits into interest (P × r) and principal (EMI − interest)', () => {
    const r = computeEmi({ principal: 1000000, annualRatePercent: 12, tenureMonths: 120 });
    expect(r.firstMonthInterest).toBeCloseTo(10000, 6);
    expect(r.firstMonthPrincipal).toBeCloseTo(r.emi - 10000, 6);
  });
});

describe('computeEmi — input validation', () => {
  const ok = { principal: 1000000, annualRatePercent: 9, tenureMonths: 240 };
  it.each([
    [{ ...ok, principal: 0 }, /principal/],
    [{ ...ok, principal: -5 }, /principal/],
    [{ ...ok, principal: EMI_LIMITS.maxPrincipal + 1 }, /principal/],
    [{ ...ok, principal: Number.NaN }, /principal/],
    [{ ...ok, annualRatePercent: -1 }, /annualRatePercent/],
    [{ ...ok, annualRatePercent: EMI_LIMITS.maxAnnualRatePercent + 0.01 }, /annualRatePercent/],
    [{ ...ok, tenureMonths: 0 }, /tenureMonths/],
    [{ ...ok, tenureMonths: 12.5 }, /tenureMonths/],
    [{ ...ok, tenureMonths: EMI_LIMITS.maxTenureMonths + 1 }, /tenureMonths/],
  ])('%j is rejected', (input, message) => {
    expect(() => computeEmi(input)).toThrow(message);
  });
});
