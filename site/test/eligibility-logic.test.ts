import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  evaluate,
  formatInr,
  formatPercent,
  fromHash,
  toHash,
  type EligibilityFormState,
} from '../src/tools/eligibility/logic.js';

const state = (s: Partial<EligibilityFormState>): EligibilityFormState => ({
  ...DEFAULT_STATE,
  ...s,
});

describe('eligibility page logic', () => {
  it('evaluates the default to the published ₹57,61,542 (₹1 lakh, 50%, 8.5%, 20 years)', () => {
    const v = evaluate(DEFAULT_STATE);
    expect(v.ok && formatInr(v.result.maxLoan)).toBe('₹57,61,542');
    expect(v.ok && v.result.availableEmi).toBe(50000);
    expect(v.ok && v.result.downPayment).toBeUndefined();
  });

  it('adds the co-applicant income and subtracts existing EMIs (page path, Indian commas)', () => {
    const v = evaluate(state({ income: '50,000', coIncome: '30,000', existing: '15,000' }));
    expect(v.ok && v.result.availableEmi).toBe(25000);
    expect(v.ok && formatInr(v.result.maxLoan)).toBe('₹28,80,771');
    expect(v.ok && formatPercent(v.result.currentFoirPercent)).toBe('18.8%');
  });

  it('shows own money needed only when a property price is entered', () => {
    const v = evaluate(state({ propertyPrice: '80,00,000' }));
    expect(v.ok && formatInr(v.result.downPayment ?? -1)).toBe('₹22,38,458');
    const zero = evaluate(state({ propertyPrice: '0' }));
    expect(zero.ok && zero.result.downPayment).toBeUndefined();
  });

  it('reports every bad field', () => {
    const v = evaluate({
      income: '0',
      coIncome: '-1',
      existing: 'abc',
      foir: '0',
      rate: '60',
      years: '0',
      propertyPrice: '-5',
    });
    expect(v.ok ? [] : v.errors).toEqual([
      'income',
      'coIncome',
      'existing',
      'foir',
      'rate',
      'years',
      'propertyPrice',
    ]);
    const big = evaluate(state({ income: '1000000000', coIncome: '1' }));
    expect(big.ok ? [] : big.errors).toEqual(['coIncome']);
  });

  it('round-trips state through the URL hash and ignores junk', () => {
    const s = state({ income: '75,000', coIncome: '25000', propertyPrice: '9000000' });
    const back = fromHash(toHash(s));
    expect(back).toEqual({ ...s, income: '75000' });
    expect(toHash(state({ existing: 'x' }))).toContain('e=0');
    expect(fromHash('#i=<script>&f=55')).toEqual({ ...DEFAULT_STATE, foir: '55' });
    expect(fromHash('')).toEqual(DEFAULT_STATE);
  });
});
