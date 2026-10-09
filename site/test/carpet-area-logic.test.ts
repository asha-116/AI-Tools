import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  evaluate,
  formatInr,
  formatNumber,
  formatPercent,
  fromHash,
  SQ_M_PER_SQ_FT,
  toHash,
  type CarpetFormState,
} from '../src/tools/carpet-area/logic.js';

const state = (s: Partial<CarpetFormState>): CarpetFormState => ({ ...DEFAULT_STATE, ...s });

describe('carpet area page logic', () => {
  it('evaluates the default (1,300 SBA, 1,000 carpet, ₹8,000 per sq ft)', () => {
    const v = evaluate(DEFAULT_STATE);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(formatPercent(v.result.loadingOnCarpetPercent)).toBe('30%');
    expect(formatPercent(v.result.commonSharePercent)).toBe('23.1%');
    expect(formatInr(v.result.totalPrice ?? 0)).toBe('₹1,04,00,000');
    expect(formatInr(v.result.ratePerCarpet ?? 0)).toBe('₹10,400');
  });

  it('matches the published ₹1.80 crore example through the page path', () => {
    const v = evaluate(
      state({
        superBuiltUp: '1,500',
        carpet: '1,050',
        priceMode: 'total',
        priceValue: '1,80,00,000',
      }),
    );
    expect(v.ok && formatInr(v.result.ratePerSuperBuiltUp ?? 0)).toBe('₹12,000');
    expect(v.ok && formatInr(v.result.ratePerCarpet ?? 0)).toBe('₹17,143');
  });

  it('works out the carpet area from a loading % when carpet is empty', () => {
    const onCarpet = evaluate(state({ carpet: '', loading: '30' }));
    expect(onCarpet.ok && formatNumber(onCarpet.result.carpet)).toBe('1,000');
    const onSba = evaluate(
      state({ superBuiltUp: '1500', carpet: '', loading: '20', loadingBase: 'superBuiltUp' }),
    );
    expect(onSba.ok && formatNumber(onSba.result.carpet)).toBe('1,200');
    expect(onSba.ok && formatNumber(onSba.result.carpet * SQ_M_PER_SQ_FT)).toBe('111.48');
  });

  it('leaves the price out when it is empty', () => {
    const v = evaluate(state({ priceValue: '' }));
    expect(v.ok && v.result.totalPrice).toBeUndefined();
    expect(v.ok && v.result.ratePerCarpet).toBeUndefined();
  });

  it('reports bad fields', () => {
    const errs = (s: Partial<CarpetFormState>) => {
      const v = evaluate(state(s));
      return v.ok ? [] : v.errors;
    };
    expect(errs({ superBuiltUp: '0' })).toEqual(['superBuiltUp']);
    expect(errs({ carpet: '1400' })).toEqual(['carpet']);
    expect(errs({ carpet: 'abc' })).toEqual(['carpet']);
    expect(errs({ carpet: '', loading: '' })).toEqual(['carpet']);
    expect(errs({ carpet: '', loading: '100', loadingBase: 'superBuiltUp' })).toEqual(['loading']);
    expect(errs({ carpet: '', loading: '-1' })).toEqual(['loading']);
    expect(errs({ superBuiltUp: 'x', carpet: '', loading: '10' })).toEqual(['superBuiltUp']);
    expect(errs({ priceValue: '0' })).toEqual(['priceValue']);
    expect(errs({ priceMode: 'rate', priceValue: '1e12' })).toEqual(['priceValue']);
  });

  it('round-trips state through the URL hash and ignores junk', () => {
    const s = state({ carpet: '', loading: '35', loadingBase: 'superBuiltUp', priceMode: 'total' });
    expect(fromHash(toHash(s))).toEqual(s);
    expect(toHash(state({ superBuiltUp: 'x' }))).toContain('s=0');
    const junk = fromHash('#s=<b>&b=evil&m=rate&v=7000&c=900');
    expect(junk).toEqual({
      ...DEFAULT_STATE,
      superBuiltUp: '',
      carpet: '900',
      priceValue: '7000',
    });
    expect(fromHash('')).toEqual(DEFAULT_STATE);
  });
});
