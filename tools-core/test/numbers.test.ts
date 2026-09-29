import { describe, expect, it } from 'vitest';
import { assertFiniteNumber, assertNonNegative, roundTo } from '../src/index.js';

describe('roundTo', () => {
  it.each([
    [1.005, 2, 1.01],
    [2.675, 2, 2.68],
    [1234.5, 0, 1235],
    [-1.005, 2, -1.01],
    [-2.5, 0, -3],
    [0, 2, 0],
    [10, 2, 10],
    [0.1 + 0.2, 2, 0.3],
    [123456789.125, 2, 123456789.13],
    [1.23456, 4, 1.2346],
  ])('roundTo(%d, %d) === %d', (value, decimals, expected) => {
    expect(roundTo(value, decimals)).toBe(expected);
  });

  it('defaults to 2 decimals (paise)', () => {
    expect(roundTo(99.999)).toBe(100);
  });

  it('rejects non-finite values', () => {
    expect(() => roundTo(Number.NaN)).toThrow(RangeError);
    expect(() => roundTo(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects invalid decimals', () => {
    expect(() => roundTo(1, -1)).toThrow(RangeError);
    expect(() => roundTo(1, 1.5)).toThrow(RangeError);
    expect(() => roundTo(1, 11)).toThrow(RangeError);
  });
});

describe('assertFiniteNumber', () => {
  it('accepts finite numbers', () => {
    expect(() => {
      assertFiniteNumber(-5, 'x');
    }).not.toThrow();
  });

  it('names the field in the error', () => {
    expect(() => {
      assertFiniteNumber(Number.NaN, 'principal');
    }).toThrow(/principal/);
  });
});

describe('assertNonNegative', () => {
  it('accepts zero and positives', () => {
    expect(() => {
      assertNonNegative(0, 'x');
    }).not.toThrow();
    expect(() => {
      assertNonNegative(1e9, 'x');
    }).not.toThrow();
  });

  it('rejects negatives and non-finite values', () => {
    expect(() => {
      assertNonNegative(-0.01, 'rate');
    }).toThrow(/rate must be ≥ 0/);
    expect(() => {
      assertNonNegative(Number.NaN, 'rate');
    }).toThrow(RangeError);
  });
});
