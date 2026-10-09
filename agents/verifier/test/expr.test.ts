import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/expr.js';

describe('evaluate', () => {
  it('handles precedence, right-associative powers, unary minus and parentheses', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
    expect(evaluate('(1 + 2) * 3')).toBe(9);
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512);
    expect(evaluate('-2 ^ 2')).toBe(-4);
    expect(evaluate('2 ^ -1')).toBe(0.5);
    expect(evaluate('+3 - -2')).toBe(5);
    expect(evaluate('1.5e3 / .5')).toBe(3000);
  });
  it('computes an EMI exactly where models get the arithmetic wrong', () => {
    // ₹1 crore, 10.5% a year, 120 months: banks publish ₹1,34,935.
    const r = '(10.5/12/100)';
    const emi = evaluate(`10000000 * ${r} * (1 + ${r})^120 / ((1 + ${r})^120 - 1)`);
    expect(Math.round(emi)).toBe(134935);
  });
  it('accepts ×, ÷, −, ** and Indian digit grouping', () => {
    expect(evaluate('6 × 2 ÷ 3 − 1')).toBe(3);
    expect(evaluate('2 ** 10')).toBe(1024);
    expect(evaluate('1,00,000 + 1')).toBe(100001);
  });
  it('rounds to a number of decimals', () => {
    expect(evaluate('round(2.345, 2)')).toBe(2.35);
    expect(evaluate('round(2.5)')).toBe(3);
    expect(() => evaluate('round(1, 1.5)')).toThrow(/digits/);
    expect(() => evaluate('round(1, 20)')).toThrow(/digits/);
  });
  it('supports ln and ceil (number of payments after a prepayment)', () => {
    // 23 lakh left, 9%, EMI 22,493.15: about 195 payments.
    const r = '(9/1200)';
    expect(evaluate(`ceil(-ln(1 - ${r} * 2300000 / 22493.15) / ln(1 + ${r}))`)).toBe(195);
    expect(evaluate('ceil(1.2)')).toBe(2);
    expect(() => evaluate('ln(0)')).toThrow(/positive/);
    expect(() => evaluate('lnx(1)')).toThrow();
  });
  it('rejects anything that is not arithmetic', () => {
    for (const bad of [
      'process.exit()',
      'x + 1',
      '1 +',
      '(1',
      '1)',
      '',
      '1 / 0',
      'round 1',
      '2 3',
      '1 $ 2',
    ]) {
      expect(() => evaluate(bad), bad).toThrow();
    }
    expect(() => evaluate('1+'.repeat(1001) + '1')).toThrow(/too long/);
  });
});
