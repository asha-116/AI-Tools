import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  evaluate,
  formatInr,
  formatSigned,
  fromHash,
  toHash,
  toMonths,
  type TransferFormState,
} from '../src/tools/balance-transfer/logic.js';

const state = (s: Partial<TransferFormState>): TransferFormState => ({ ...DEFAULT_STATE, ...s });

describe('balance transfer page logic', () => {
  it('evaluates the default to the published Kotak example (new EMI ₹35,405)', () => {
    const v = evaluate(DEFAULT_STATE);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(formatInr(v.result.newEmi)).toBe('₹35,405');
    // ₹24.34 lakh of interest on the new loan, as published.
    expect(Math.round(v.result.newInterest / 1000) / 100).toBe(24.34);
    expect(v.result.netSaving).toBeCloseTo(v.result.interestSaved - 25_000, 6);
    expect(v.result.breakEvenMonths).toBe(Math.ceil(25_000 / v.result.emiDrop));
  });

  it('a longer new tenure uses the years given (Kotak: 25 years → ₹27,840)', () => {
    const v = evaluate(state({ newYears: '25' }));
    expect(v.ok && formatInr(v.result.newEmi)).toBe('₹27,840');
    expect(v.ok && v.result.breakEvenMonths).toBeNull();
  });

  it('accepts Indian commas and empty optional fields', () => {
    const v = evaluate(state({ outstanding: '39,39,000', switchingCosts: '', newYears: ' ' }));
    expect(v.ok && v.result.breakEvenMonths).toBe(0);
  });

  it('turns years into whole months', () => {
    expect(toMonths('15')).toBe(180);
    expect(toMonths('12.5')).toBe(150);
    expect(toMonths('0.1')).toBe(1);
    expect(toMonths('0')).toBeNaN();
    expect(toMonths('41')).toBeNaN();
    expect(toMonths('x')).toBeNaN();
  });

  it('shows a loss with a minus sign', () => {
    expect(formatSigned(-1234.4)).toBe('−₹1,234');
    expect(formatSigned(1234.6)).toBe('₹1,235');
    expect(formatSigned(-0.4)).toBe('₹0');
  });

  it('reports bad fields', () => {
    const errs = (s: Partial<TransferFormState>) => {
      const v = evaluate(state(s));
      return v.ok ? [] : v.errors;
    };
    expect(errs({ outstanding: '0' })).toEqual(['outstanding']);
    expect(errs({ currentRate: '60' })).toEqual(['currentRate']);
    expect(errs({ yearsLeft: '' })).toEqual(['yearsLeft']);
    expect(errs({ newRate: 'x' })).toEqual(['newRate']);
    expect(errs({ newYears: '50' })).toEqual(['newYears']);
    expect(errs({ switchingCosts: '-5' })).toEqual(['switchingCosts']);
  });

  it('round-trips state through the URL hash and ignores junk', () => {
    const s = state({ newYears: '20', switchingCosts: '' });
    expect(fromHash(toHash(s))).toEqual(s);
    expect(toHash(state({ outstanding: 'x' }))).toContain('o=0');
    expect(fromHash('#o=<b>&r=9&y=10')).toEqual({
      outstanding: '',
      currentRate: '9',
      yearsLeft: '10',
      newRate: '',
      newYears: '',
      switchingCosts: '',
    });
    expect(fromHash('')).toEqual(DEFAULT_STATE);
  });
});
