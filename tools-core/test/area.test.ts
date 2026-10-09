import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AREA_LIMITS, convertArea, convertToAll, type AreaUnit } from '../src/index.js';

interface UnitsFile {
  status: string;
  units: Array<AreaUnit & { label_en: string; label_hi: string; sq_ft?: number }>;
}
const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../data/land-units/${name}.json`, import.meta.url), 'utf8'),
  ) as UnitsFile;
const standard = read('standard');
const guntha = read('guntha');
const regional = read('regional');
const units = [...standard.units, ...guntha.units, ...regional.units];
const unit = (id: string): AreaUnit => {
  const u = units.find((x) => x.id === id);
  if (!u) throw new Error(`unknown unit ${id}`);
  return u;
};

interface Case {
  name: string;
  value: number;
  from: string;
  to: string;
  expect: number;
  sources: string[];
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/area-known-answers.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

describe('area known answers (cited sources)', () => {
  it('has at least 10 cases, each with a source', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
    for (const c of fixture.cases) expect(c.sources.length, c.name).toBeGreaterThan(0);
  });
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const got = convertArea(c.value, unit(c.from), unit(c.to));
    expect(Math.abs(got - c.expect) / c.expect).toBeLessThan(1e-9);
  });
});

describe('land-unit data files', () => {
  it('standard units and the owner-verified guntha are live; other regional units stay draft', () => {
    expect(standard.status).toBe('verified');
    expect(guntha.status).toBe('verified'); // owner-confirmed for MH + KA, 2026-10-09
    expect(regional.status).toBe('draft');
  });
  it('ids are unique and every unit has EN + HI labels', () => {
    const ids = units.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const u of units) {
      expect(u.label_en.trim(), u.id).not.toBe('');
      expect(u.label_hi, u.id).toMatch(/[ऀ-ॿ]/);
    }
  });
  it('regional sq_m values match their sq_ft definitions (1 sq ft = 0.09290304 m²)', () => {
    for (const u of [...guntha.units, ...regional.units]) {
      expect(u.sq_ft, u.id).toBeDefined();
      expect(Math.abs(u.sq_m - (u.sq_ft ?? 0) * 0.09290304)).toBeLessThan(1e-9);
    }
  });
});

describe('convertArea', () => {
  const sqFt = unit('sq_ft');
  const acre = unit('acre');
  it('round-trips and converts a unit to itself unchanged', () => {
    expect(convertArea(2.5, acre, acre)).toBe(2.5);
    expect(convertArea(convertArea(1234.5, sqFt, acre), acre, sqFt)).toBeCloseTo(1234.5, 9);
    expect(convertArea(0, sqFt, acre)).toBe(0);
  });
  it('rejects negative, non-finite or too-large values and bad units', () => {
    expect(() => convertArea(-1, sqFt, acre)).toThrow(RangeError);
    expect(() => convertArea(Number.NaN, sqFt, acre)).toThrow();
    expect(() => convertArea(AREA_LIMITS.maxValue + 1, sqFt, acre)).toThrow(RangeError);
    expect(() => convertArea(1, { id: 'x', sq_m: 0 }, acre)).toThrow(RangeError);
  });
});

describe('are (Maharashtra 7/12 records hectare-are)', () => {
  it('1 hectare = 100 are, and 1 guntha ≈ 1.0117 are', () => {
    expect(convertArea(1, unit('hectare'), unit('are'))).toBeCloseTo(100, 12);
    expect(convertArea(1, unit('guntha'), unit('are'))).toBeCloseTo(1.0117141056, 9);
    expect(convertArea(40, unit('guntha'), unit('acre'))).toBeCloseTo(1, 12);
  });
});

describe('convertToAll', () => {
  it('gives the value in every unit, in the order given', () => {
    const r = convertToAll(1, unit('acre'), standard.units);
    expect(r.map((x) => x.id)).toEqual(['sq_ft', 'sq_yd', 'sq_m', 'are', 'acre', 'hectare']);
    expect(r[0]?.value).toBeCloseTo(43560, 6);
    expect(r[1]?.value).toBeCloseTo(4840, 6);
  });
});
