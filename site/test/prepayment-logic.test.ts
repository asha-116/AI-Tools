import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  evaluate,
  formatDuration,
  formatInr,
  fromHash,
  toHash,
} from '../src/tools/prepayment/logic.js';
import { prepayStrings } from '../src/tools/prepayment/strings.js';

const en = prepayStrings.en;
const dur = {
  year: en.durationYear,
  years: en.durationYears,
  month: en.durationMonth,
  months: en.durationMonths,
  zero: en.durationZero,
};

describe('prepayment page logic', () => {
  it('evaluates the default (₹50 lakh, 8.5%, 20 years, ₹5 lakh after year 3)', () => {
    const v = evaluate(DEFAULT_STATE);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(formatInr(v.result.emi)).toBe('₹43,391');
    expect(v.result.baseline.months).toBe(240);
    expect(v.result.withPrepayment.months).toBeLessThan(240);
    expect(v.result.interestSaved).toBeGreaterThan(0);
    expect(v.result.withPrepayment.totalPrepaid).toBe(500000);
  });

  it('matches the published example through the page path (₹25 lakh, 9%, ₹2 lakh now)', () => {
    const v = evaluate({
      principal: '25,00,000',
      rate: '9',
      years: '20',
      lump: '2,00,000',
      lumpYear: '0',
      monthly: '',
      yearly: '',
    });
    expect(v.ok && v.result.withPrepayment.months).toBe(195);
    expect(v.ok && formatDuration(v.result.monthsSaved, dur)).toBe('3 years 9 months');
  });

  it('treats empty prepayment fields as 0 and reports bad fields', () => {
    const none = evaluate({ ...DEFAULT_STATE, lump: '', lumpYear: '', monthly: '', yearly: '' });
    expect(none.ok && none.result.interestSaved).toBe(0);
    expect(
      evaluate({
        ...DEFAULT_STATE,
        principal: '0',
        rate: '99',
        years: '50',
        lump: '-1',
        lumpYear: '1.5',
        monthly: 'x',
        yearly: '-2',
      }),
    ).toEqual({
      ok: false,
      errors: ['principal', 'rate', 'years', 'lump', 'lumpYear', 'monthly', 'yearly'],
    });
    expect(evaluate({ ...DEFAULT_STATE, years: '5', lumpYear: '6' })).toEqual({
      ok: false,
      errors: ['lumpYear'],
    });
  });

  it('formats durations', () => {
    expect(formatDuration(0, dur)).toBe('0 months');
    expect(formatDuration(12, dur)).toBe('1 year');
    expect(formatDuration(13, dur)).toBe('1 year 1 month');
    expect(formatDuration(203, dur)).toBe('16 years 11 months');
    expect(formatDuration(5, dur)).toBe('5 months');
  });

  it('round-trips the URL hash and ignores junk', () => {
    const h = toHash({ ...DEFAULT_STATE, monthly: '' });
    expect(h).toBe('#p=5000000&r=8.5&y=20&l=500000&ly=3&m=0&a=0');
    expect(fromHash(h)).toEqual({ ...DEFAULT_STATE, monthly: '0' });
    expect(fromHash('#p=<x>&r=9')).toEqual({ ...DEFAULT_STATE, rate: '9' });
    expect(toHash({ ...DEFAULT_STATE, lump: 'abc' })).toContain('l=0');
  });

  it('has the same string keys in EN and HI', () => {
    expect(Object.keys(prepayStrings.hi).sort()).toEqual(Object.keys(en).sort());
    expect(prepayStrings.hi.assumptions).toHaveLength(en.assumptions.length);
  });
});
