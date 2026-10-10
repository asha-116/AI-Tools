import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BALANCE_TRANSFER_LIMITS,
  computeBalanceTransfer,
  computeEmi,
  type BalanceTransferInput,
  type BalanceTransferResult,
} from '../src/index.js';

interface Case {
  name: string;
  input: BalanceTransferInput;
  expect: Partial<Record<keyof BalanceTransferResult, number>>;
  tolerance: { percent: number };
  sources: string[];
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/balance-transfer-known-answers.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

describe('balance transfer known answers (published examples)', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(c.sources.length).toBeGreaterThan(0);
    const r = computeBalanceTransfer(c.input);
    for (const [k, v] of Object.entries(c.expect)) {
      const got = r[k as keyof BalanceTransferResult];
      if (typeof got !== 'number') throw new Error(`${k} is not a number`);
      if (v === 0) expect(Math.abs(got), k).toBeLessThan(1e-6);
      else expect((Math.abs(got - v) / v) * 100, k).toBeLessThanOrEqual(c.tolerance.percent);
    }
  });
});

describe('computeBalanceTransfer', () => {
  const base: BalanceTransferInput = {
    outstanding: 3_939_000,
    currentRatePercent: 8,
    remainingMonths: 180,
    newRatePercent: 7,
  };

  it('compares the same remaining tenure at both rates', () => {
    const r = computeBalanceTransfer({ ...base, switchingCosts: 50_000 });
    const cur = computeEmi({ principal: 3_939_000, annualRatePercent: 8, tenureMonths: 180 });
    const nxt = computeEmi({ principal: 3_939_000, annualRatePercent: 7, tenureMonths: 180 });
    expect(r.currentEmi).toBeCloseTo(cur.emi, 9);
    expect(r.newEmi).toBeCloseTo(nxt.emi, 9);
    expect(r.emiDrop).toBeCloseTo(cur.emi - nxt.emi, 9);
    expect(r.currentInterestLeft).toBeCloseTo(cur.totalInterest, 6);
    expect(r.newInterest).toBeCloseTo(nxt.totalInterest, 6);
    expect(r.interestSaved).toBeCloseTo(cur.totalInterest - nxt.totalInterest, 6);
    expect(r.netSaving).toBeCloseTo(r.interestSaved - 50_000, 6);
    // Same tenure: the saving is the EMI drop every month.
    expect(r.interestSaved).toBeCloseTo(r.emiDrop * 180, 6);
    expect(r.breakEvenMonths).toBe(Math.ceil(50_000 / r.emiDrop));
  });

  it('breaks even at once with no switching costs', () => {
    expect(computeBalanceTransfer(base).breakEvenMonths).toBe(0);
    expect(computeBalanceTransfer(base).netSaving).toBe(computeBalanceTransfer(base).interestSaved);
  });

  it('never breaks even when the new EMI is not lower', () => {
    const r = computeBalanceTransfer({ ...base, newRatePercent: 9, switchingCosts: 10_000 });
    expect(r.emiDrop).toBeLessThan(0);
    expect(r.netSaving).toBeLessThan(0);
    expect(r.breakEvenMonths).toBeNull();
  });

  it('a longer new tenure lowers the EMI but can cost more interest', () => {
    const r = computeBalanceTransfer({ ...base, newTenureMonths: 300, switchingCosts: 20_000 });
    expect(r.emiDrop).toBeGreaterThan(0);
    expect(r.interestSaved).toBeLessThan(0);
    // Break-even by EMI drop is only meaningful when the tenure stays the same.
    expect(r.breakEvenMonths).toBeNull();
  });

  it('handles a 0% rate', () => {
    const r = computeBalanceTransfer({ ...base, newRatePercent: 0 });
    expect(r.newEmi).toBeCloseTo(3_939_000 / 180, 9);
    expect(r.newInterest).toBeCloseTo(0, 6);
  });

  it('rejects inputs out of range', () => {
    const bad: Array<Partial<BalanceTransferInput>> = [
      { outstanding: 0 },
      { outstanding: BALANCE_TRANSFER_LIMITS.maxAmount + 1 },
      { outstanding: Number.NaN },
      { currentRatePercent: -1 },
      { newRatePercent: 51 },
      { remainingMonths: 0 },
      { remainingMonths: 12.5 },
      { remainingMonths: 481 },
      { newTenureMonths: 0 },
      { switchingCosts: -1 },
      { switchingCosts: Number.POSITIVE_INFINITY },
    ];
    for (const b of bad) {
      expect(() => computeBalanceTransfer({ ...base, ...b }), JSON.stringify(b)).toThrow(
        RangeError,
      );
    }
  });
});
