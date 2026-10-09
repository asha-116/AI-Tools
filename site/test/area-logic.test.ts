import { describe, expect, it } from 'vitest';
import { ALL_UNITS } from '../src/tools/area/data.js';
import {
  DEFAULT_STATE,
  evaluate,
  formatArea,
  fromHash,
  toHash,
  visibleUnits,
} from '../src/tools/area/logic.js';
import { areaStrings } from '../src/tools/area/strings.js';

describe('area converter page logic', () => {
  const live = visibleUnits(ALL_UNITS, false);

  it('shows only verified units on the live site; drafts on owner review', () => {
    expect(live.map((u) => u.id)).toEqual(['sq_ft', 'sq_yd', 'sq_m', 'are', 'acre', 'hectare']);
    expect(visibleUnits(ALL_UNITS, true).length).toBeGreaterThan(live.length);
  });

  it('converts the default (1 acre) to every live unit', () => {
    const v = evaluate(live, DEFAULT_STATE);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const out = Object.fromEntries(v.rows.map((r) => [r.id, formatArea(r.value)]));
    expect(out).toEqual({
      sq_ft: '43,560',
      sq_yd: '4,840',
      sq_m: '4,046.8564',
      are: '40.4686',
      acre: '1',
      hectare: '0.4047',
    });
  });

  it('a 200 gaj plot through the page path', () => {
    const v = evaluate(live, { value: '200', from: 'sq_yd' });
    expect(v.ok && formatArea(v.rows.find((r) => r.id === 'sq_ft')?.value ?? 0)).toBe('1,800');
  });

  it('rejects bad input and units that are not shown', () => {
    expect(evaluate(live, { value: '-1', from: 'acre' })).toEqual({ ok: false, error: 'value' });
    expect(evaluate(live, { value: 'abc', from: 'acre' })).toEqual({ ok: false, error: 'value' });
    expect(evaluate(live, { value: '1', from: 'guntha' })).toEqual({ ok: false, error: 'unit' });
  });

  it('formats small and grouped numbers', () => {
    expect(formatArea(1234567.891234)).toBe('12,34,567.8912');
    expect(formatArea(0.000123456)).toBe('0.0001235');
    expect(formatArea(0)).toBe('0');
  });

  it('round-trips the URL hash and ignores junk', () => {
    const h = toHash({ value: '2,500', from: 'sq_ft' }, true);
    expect(h).toBe('#v=2500&u=sq_ft&drafts=1');
    expect(fromHash(h)).toEqual({ state: { value: '2500', from: 'sq_ft' }, showDrafts: true });
    expect(fromHash('#v=<x>&u=../../')).toEqual({ state: DEFAULT_STATE, showDrafts: false });
  });

  it('has the same string keys in EN and HI', () => {
    expect(Object.keys(areaStrings.hi).sort()).toEqual(Object.keys(areaStrings.en).sort());
    expect(areaStrings.hi.assumptions).toHaveLength(areaStrings.en.assumptions.length);
  });
});
