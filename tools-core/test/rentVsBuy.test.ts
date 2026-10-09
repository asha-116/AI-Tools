import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeEmi,
  computeRentVsBuy,
  RENT_VS_BUY_LIMITS,
  type RentVsBuyInput,
  type RentVsBuyResult,
} from '../src/index.js';

interface Case {
  name: string;
  input: RentVsBuyInput;
  expect: Partial<Record<keyof RentVsBuyResult, number>>;
  tolerance: { percent: number };
  sources: string[];
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/rent-vs-buy-known-answers.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

describe('rent vs buy known answers (published examples)', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(c.sources.length).toBeGreaterThan(0);
    const r = computeRentVsBuy(c.input);
    for (const [k, v] of Object.entries(c.expect)) {
      const got = r[k as keyof RentVsBuyResult];
      expect((Math.abs(got - v) / v) * 100, k).toBeLessThanOrEqual(c.tolerance.percent);
    }
  });
});

const base: RentVsBuyInput = {
  propertyValue: 7_500_000,
  downPayment: 1_500_000,
  purchaseCosts: 500_000,
  annualRatePercent: 8.5,
  tenureMonths: 240,
  ownerYearlyCosts: 30_000,
  appreciationPercent: 5,
  monthlyRent: 25_000,
  rentIncreasePercent: 5,
  investReturnPercent: 8,
  years: 10,
};

/** Closed forms (Wikipedia: Mortgage calculator, Compound interest, Geometric series). */
const balanceAfter = (P: number, r: number, A: number, k: number) =>
  P * (1 + r) ** k - (A * ((1 + r) ** k - 1)) / r;
const rentTotal = (R: number, i: number, years: number) =>
  i === 0 ? 12 * R * years : (12 * R * ((1 + i) ** years - 1)) / i;

describe('computeRentVsBuy against closed forms', () => {
  it('EMI, loan left, property value and rent paid', () => {
    const r = computeRentVsBuy(base);
    const emi = computeEmi({ principal: 6_000_000, annualRatePercent: 8.5, tenureMonths: 240 }).emi;
    expect(r.emi).toBeCloseTo(emi, 8);
    expect(r.loanLeft).toBeCloseTo(balanceAfter(6_000_000, 8.5 / 1200, emi, 120), 2);
    expect(r.propertyEnd).toBeCloseTo(7_500_000 * 1.05 ** 10, 4);
    expect(r.rentPaid).toBeCloseTo(rentTotal(25_000, 0.05, 10), 4);
    expect(r.buyerCashOut).toBeCloseTo(1_500_000 + 500_000 + emi * 120 + 30_000 * 10, 2);
    expect(r.buyerWealth - r.renterWealth).toBeCloseTo(r.difference, 6);
  });

  it('with no investment return, wealth is just the money kept (equal spending each month)', () => {
    const r = computeRentVsBuy({ ...base, investReturnPercent: 0 });
    // Buying costs more than renting every month here, so the renter keeps the whole gap.
    const gap = r.buyerCashOut - 2_000_000 - r.rentPaid;
    expect(r.renterWealth).toBeCloseTo(2_000_000 + gap, 2);
    expect(r.buyerWealth).toBeCloseTo(r.propertyEnd - r.loanLeft, 2);
  });

  it('when rent is higher than the buyer’s monthly cost, the buyer keeps the gap', () => {
    const r = computeRentVsBuy({
      ...base,
      investReturnPercent: 0,
      monthlyRent: 200_000,
      rentIncreasePercent: 0,
      purchaseCosts: 0,
    });
    const buyerMonthly = r.emi + 30_000 / 12;
    expect(r.renterWealth).toBe(1_500_000);
    expect(r.buyerWealth).toBeCloseTo(
      r.propertyEnd - r.loanLeft + (200_000 - buyerMonthly) * 120,
      2,
    );
  });

  it('a 10% yearly return compounds monthly to exactly 10% a year', () => {
    const r = computeRentVsBuy({
      ...base,
      downPayment: 7_500_000,
      purchaseCosts: 0,
      ownerYearlyCosts: 0,
      monthlyRent: 1,
      rentIncreasePercent: 0,
      investReturnPercent: 10,
      years: 3,
    });
    // Renter invests the ₹75 lakh; the buyer saves ₹1 a month (rent) — tiny, but counted.
    expect(r.emi).toBe(0);
    expect(r.loanLeft).toBe(0);
    expect(r.renterWealth).toBeCloseTo(7_500_000 * 1.1 ** 3, 2);
    expect(r.buyerWealth).toBeGreaterThan(r.propertyEnd);
  });

  it('after the loan is repaid there is no EMI and nothing left to pay', () => {
    const r = computeRentVsBuy({ ...base, tenureMonths: 60, years: 8 });
    const emi = computeEmi({ principal: 6_000_000, annualRatePercent: 8.5, tenureMonths: 60 }).emi;
    expect(r.loanLeft).toBe(0);
    expect(r.buyerCashOut).toBeCloseTo(2_000_000 + emi * 60 + 30_000 * 8, 2);
  });

  it('handles 0% loan rate, no rent increase and falling property prices', () => {
    const r = computeRentVsBuy({
      ...base,
      annualRatePercent: 0,
      rentIncreasePercent: 0,
      appreciationPercent: -2,
    });
    expect(r.emi).toBe(25_000);
    expect(r.loanLeft).toBeCloseTo(6_000_000 - 25_000 * 120, 6);
    expect(r.rentPaid).toBe(25_000 * 120);
    expect(r.propertyEnd).toBeCloseTo(7_500_000 * 0.98 ** 10, 4);
  });

  it('rejects inputs out of range', () => {
    const bad: Array<Partial<RentVsBuyInput>> = [
      { propertyValue: 0 },
      { propertyValue: RENT_VS_BUY_LIMITS.maxAmount + 1 },
      { downPayment: -1 },
      { downPayment: 7_500_001 },
      { purchaseCosts: -1 },
      { ownerYearlyCosts: Number.NaN },
      { monthlyRent: 0 },
      { annualRatePercent: 51 },
      { tenureMonths: 0 },
      { tenureMonths: 12.5 },
      { years: 0 },
      { years: 41 },
      { years: 2.5 },
      { appreciationPercent: -51 },
      { rentIncreasePercent: -1 },
      { investReturnPercent: 51 },
    ];
    for (const b of bad) expect(() => computeRentVsBuy({ ...base, ...b })).toThrow(RangeError);
  });
});
