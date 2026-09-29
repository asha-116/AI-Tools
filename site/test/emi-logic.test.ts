import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  evaluate,
  formatInr,
  fromHash,
  parseAmount,
  toHash,
} from '../src/tools/emi/logic.js';
import { emiStrings } from '../src/tools/emi/strings.js';

describe('EMI page logic', () => {
  it('parses Indian-formatted amounts', () => {
    expect(parseAmount('25,00,000')).toBe(2500000);
    expect(parseAmount(' ₹ 25 00 000 ')).toBe(2500000);
    expect(parseAmount('8.5')).toBe(8.5);
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('abc')).toBeNaN();
  });

  it('evaluates the default state (₹25 lakh, 8.5%, 20 years)', () => {
    const v = evaluate(DEFAULT_STATE);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.months).toBe(240);
      expect(formatInr(v.result.emi)).toBe('₹21,696');
    }
  });

  it('matches a published known answer through the page path (₹20 lakh, 8.5%, 240 months)', () => {
    const v = evaluate({ principal: '20,00,000', rate: '8.5', tenure: '240', unit: 'months' });
    expect(v.ok && Math.round(v.result.emi)).toBe(17356);
  });

  it('reports every invalid field', () => {
    expect(evaluate({ principal: '0', rate: '-1', tenure: '0', unit: 'years' })).toEqual({
      ok: false,
      errors: ['principal', 'rate', 'tenure'],
    });
    expect(evaluate({ ...DEFAULT_STATE, tenure: '41' })).toEqual({ ok: false, errors: ['tenure'] });
    expect(evaluate({ ...DEFAULT_STATE, unit: 'months', tenure: '12.5' })).toEqual({
      ok: false,
      errors: ['tenure'],
    });
  });

  it('rounds fractional years to whole months', () => {
    const v = evaluate({ ...DEFAULT_STATE, tenure: '1.5' });
    expect(v.ok && v.months).toBe(18);
  });

  it('round-trips state through the URL hash', () => {
    const state = { principal: '35,00,000', rate: '8.65', tenure: '360', unit: 'months' as const };
    const hash = toHash(state);
    expect(hash).toBe('#p=3500000&r=8.65&t=360&u=m');
    expect(fromHash(hash)).toEqual({ ...state, principal: '3500000' });
  });

  it('falls back to defaults for missing or unsafe hash values', () => {
    expect(fromHash('')).toEqual(DEFAULT_STATE);
    expect(fromHash('#p=<script>&r=abc&t=&u=x')).toEqual(DEFAULT_STATE);
  });

  it('formats with Indian digit grouping', () => {
    expect(formatInr(2500000)).toBe('₹25,00,000');
    expect(formatInr(13493.4997)).toBe('₹13,493');
    expect(formatInr(0)).toBe('₹0');
  });
});

describe('EMI strings', () => {
  it('has the same non-empty keys in EN and HI', () => {
    expect(Object.keys(emiStrings.hi).sort()).toEqual(Object.keys(emiStrings.en).sort());
    for (const lang of ['en', 'hi'] as const) {
      for (const [k, v] of Object.entries(emiStrings[lang])) {
        const values = Array.isArray(v) ? v : [v];
        for (const x of values) expect(x.trim(), `${lang}.${k}`).not.toBe('');
      }
    }
    expect(emiStrings.hi.assumptions).toHaveLength(emiStrings.en.assumptions.length);
  });

  it('keeps placeholders in the first-month template', () => {
    for (const lang of ['en', 'hi'] as const) {
      expect(emiStrings[lang].resultFirstMonth).toContain('{interest}');
      expect(emiStrings[lang].resultFirstMonth).toContain('{principal}');
    }
  });
});
