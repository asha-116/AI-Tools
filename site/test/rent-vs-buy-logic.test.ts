import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  evaluate,
  formatInr,
  formatSignedInr,
  fromHash,
  toHash,
  type RvbFormState,
} from '../src/tools/rent-vs-buy/logic.js';

const state = (s: Partial<RvbFormState>): RvbFormState => ({ ...DEFAULT_STATE, ...s });

describe('rent vs buy page logic', () => {
  it('evaluates the default (₹75 lakh, ₹15 lakh down, 8.5%, 20 years, ₹25,000 rent)', () => {
    const v = evaluate(DEFAULT_STATE);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(formatInr(v.result.emi)).toBe('₹52,069');
    expect(v.result.difference).toBeCloseTo(v.result.buyerWealth - v.result.renterWealth, 6);
    expect(v.result.loanLeft).toBeGreaterThan(0);
  });

  it('treats empty optional fields as 0 (Indian commas) and accepts a falling property value', () => {
    const v = evaluate(
      state({
        propertyValue: '75,00,000',
        purchaseCosts: '',
        ownerCosts: '',
        rentIncrease: '',
        investReturn: '',
        appreciation: '-3',
      }),
    );
    expect(v.ok && v.result.propertyEnd).toBeCloseTo(7_500_000 * 0.97 ** 10, 2);
  });

  it('shows the sign of a negative amount', () => {
    expect(formatSignedInr(-1234567, formatInr)).toBe('−₹12,34,567');
    expect(formatSignedInr(500, formatInr)).toBe('₹500');
  });

  it('reports every bad field', () => {
    const v = evaluate({
      propertyValue: '0',
      downPayment: '-1',
      purchaseCosts: '-1',
      rate: '60',
      loanYears: '0',
      ownerCosts: 'x',
      appreciation: '-60',
      rent: '0',
      rentIncrease: '70',
      investReturn: '-1',
      years: '2.5',
    });
    expect(v.ok ? [] : v.errors).toEqual([
      'propertyValue',
      'downPayment',
      'purchaseCosts',
      'rate',
      'loanYears',
      'ownerCosts',
      'appreciation',
      'rent',
      'rentIncrease',
      'investReturn',
      'years',
    ]);
    const tooMuchDown = evaluate(state({ downPayment: '8000000' }));
    expect(tooMuchDown.ok ? [] : tooMuchDown.errors).toEqual(['downPayment']);
  });

  it('round-trips state through the URL hash and ignores junk', () => {
    const s = state({ propertyValue: '90,00,000', appreciation: '-2', purchaseCosts: '' });
    expect(fromHash(toHash(s))).toEqual({ ...s, propertyValue: '9000000' });
    expect(toHash(state({ rent: 'x' }))).toContain('m=0');
    const junk = fromHash('#v=<b>&m=30000');
    expect(junk.rent).toBe('30000');
    expect(junk.propertyValue).toBe('');
    expect(fromHash('')).toEqual(DEFAULT_STATE);
  });
});
