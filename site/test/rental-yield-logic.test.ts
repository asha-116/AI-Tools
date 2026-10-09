import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  evaluate,
  formatInr,
  formatPercent,
  formatYears,
  fromHash,
  toHash,
  type YieldFormState,
} from '../src/tools/rental-yield/logic.js';

const state = (s: Partial<YieldFormState>): YieldFormState => ({ ...DEFAULT_STATE, ...s });

describe('rental yield page logic', () => {
  it('evaluates the default to the published Pune example (3.33% net, 4% gross)', () => {
    const v = evaluate(DEFAULT_STATE);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(formatPercent(v.result.netYieldPercent)).toBe('3.33%');
    expect(formatPercent(v.result.grossYieldPercent)).toBe('4%');
    expect(formatInr(v.result.collectedRent)).toBe('₹2,30,000');
    expect(formatInr(v.result.netIncome)).toBe('₹2,00,000');
    expect(formatYears(v.result.yearsOfRent)).toBe('25');
  });

  it('treats empty optional fields as 0 and adds purchase costs (Indian commas)', () => {
    const v = evaluate({
      propertyValue: '1,00,00,000',
      purchaseCosts: '',
      monthlyRent: '30,000',
      vacancyMonths: '',
      yearlyCosts: '40,000',
    });
    expect(v.ok && formatPercent(v.result.grossYieldPercent)).toBe('3.6%');
    expect(v.ok && formatPercent(v.result.netYieldPercent)).toBe('3.2%');
    const withCosts = evaluate(state({ purchaseCosts: '6,00,000' }));
    expect(withCosts.ok && formatInr(withCosts.result.investment)).toBe('₹66,00,000');
  });

  it('reports every bad field', () => {
    const v = evaluate({
      propertyValue: '0',
      purchaseCosts: '-1',
      monthlyRent: 'abc',
      vacancyMonths: '13',
      yearlyCosts: '-5',
    });
    expect(v.ok ? [] : v.errors).toEqual([
      'propertyValue',
      'purchaseCosts',
      'monthlyRent',
      'vacancyMonths',
      'yearlyCosts',
    ]);
  });

  it('round-trips state through the URL hash and ignores junk', () => {
    const s = state({ propertyValue: '75,00,000', purchaseCosts: '500000' });
    expect(fromHash(toHash(s))).toEqual({ ...s, propertyValue: '7500000' });
    expect(toHash(state({ monthlyRent: 'x' }))).toContain('r=0');
    expect(fromHash('#v=<b>&r=25000')).toEqual({
      propertyValue: '',
      purchaseCosts: '',
      monthlyRent: '25000',
      vacancyMonths: '',
      yearlyCosts: '',
    });
    expect(fromHash('')).toEqual(DEFAULT_STATE);
  });
});
