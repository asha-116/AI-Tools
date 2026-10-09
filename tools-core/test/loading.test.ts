import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  carpetFromLoading,
  computeLoading,
  LOADING_LIMITS,
  type LoadingInput,
  type LoadingResult,
} from '../src/index.js';

interface Case {
  name: string;
  input: LoadingInput;
  expect: Partial<Record<keyof LoadingResult, number>>;
  tolerance?: { rate: number };
  sources: string[];
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/loading-known-answers.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

describe('loading known answers (published examples)', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(c.sources.length).toBeGreaterThan(0);
    const r = computeLoading(c.input);
    for (const [k, v] of Object.entries(c.expect)) {
      const got = r[k as keyof LoadingResult] as number;
      expect(Math.abs(got - v), k).toBeLessThanOrEqual(c.tolerance?.rate ?? 1e-9);
    }
  });
});

describe('computeLoading', () => {
  it('splits super built-up into carpet and common area', () => {
    const r = computeLoading({ carpet: 1000, superBuiltUp: 1300 });
    expect(r.commonArea).toBe(300);
    expect(r.loadingOnCarpetPercent).toBeCloseTo(30, 12);
    expect(r.commonSharePercent).toBeCloseTo(300 / 13, 12);
    expect(r.ratePerSuperBuiltUp).toBeUndefined();
    expect(r.ratePerCarpet).toBeUndefined();
  });

  it('the carpet rate is the quoted rate × (1 + loading on carpet)', () => {
    const r = computeLoading({ carpet: 1000, superBuiltUp: 1300, totalPrice: 13_000_000 });
    expect(r.ratePerSuperBuiltUp).toBe(10000);
    expect(r.ratePerCarpet).toBe(13000);
  });

  it('allows no loading at all', () => {
    const r = computeLoading({ carpet: 800, superBuiltUp: 800 });
    expect(r.loadingOnCarpetPercent).toBe(0);
    expect(r.commonSharePercent).toBe(0);
  });

  it('rejects bad inputs, including carpet larger than super built-up', () => {
    const bad: LoadingInput[] = [
      { carpet: 0, superBuiltUp: 100 },
      { carpet: 100, superBuiltUp: 99 },
      { carpet: 100, superBuiltUp: LOADING_LIMITS.maxArea + 1 },
      { carpet: Number.NaN, superBuiltUp: 100 },
      { carpet: 100, superBuiltUp: 120, totalPrice: 0 },
      { carpet: 100, superBuiltUp: 120, totalPrice: LOADING_LIMITS.maxPrice + 1 },
    ];
    for (const b of bad) expect(() => computeLoading(b)).toThrow(RangeError);
  });
});

describe('carpetFromLoading', () => {
  it('inverts both ways of quoting loading', () => {
    expect(carpetFromLoading(1300, 30, 'carpet')).toBeCloseTo(1000, 9);
    expect(carpetFromLoading(1500, 20, 'superBuiltUp')).toBeCloseTo(1200, 9);
    for (const base of ['carpet', 'superBuiltUp'] as const) {
      expect(carpetFromLoading(1000, 0, base)).toBe(1000);
    }
  });

  it('round-trips with computeLoading', () => {
    const sba = 1462;
    const c1 = carpetFromLoading(sba, 37.5, 'carpet');
    expect(computeLoading({ carpet: c1, superBuiltUp: sba }).loadingOnCarpetPercent).toBeCloseTo(
      37.5,
      9,
    );
    const c2 = carpetFromLoading(sba, 37.5, 'superBuiltUp');
    expect(computeLoading({ carpet: c2, superBuiltUp: sba }).commonSharePercent).toBeCloseTo(
      37.5,
      9,
    );
  });

  it('rejects loading out of range', () => {
    expect(() => carpetFromLoading(1000, -1, 'carpet')).toThrow(RangeError);
    expect(() => carpetFromLoading(1000, LOADING_LIMITS.maxLoadingPercent + 1, 'carpet')).toThrow(
      RangeError,
    );
    expect(() => carpetFromLoading(1000, 100, 'superBuiltUp')).toThrow(RangeError);
    expect(() => carpetFromLoading(0, 10, 'carpet')).toThrow(RangeError);
  });
});
