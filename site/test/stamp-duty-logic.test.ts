import { readdirSync, readFileSync } from 'node:fs';
import type { StateRates } from '@toolshop/tools-core';
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  fromHash,
  localizeResult,
  toHash,
  visibleStates,
} from '../src/tools/stamp-duty/logic.js';
import { sdStrings } from '../src/tools/stamp-duty/strings.js';

/** Array access that fails loudly instead of using a non-null assertion. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`missing index ${String(i)}`);
  return v;
}

const dir = new URL('../../data/stamp-duty/', import.meta.url);
const drafts: StateRates[] = readdirSync(dir)
  .filter((f) => /^[A-Z]{2}\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as StateRates);
const verified = drafts.map((s) => ({ ...s, status: 'verified' as const }));

describe('stamp duty page logic', () => {
  it('hides draft states on the live site and shows them in review mode', () => {
    expect(visibleStates(drafts, false)).toEqual([]);
    expect(visibleStates(drafts, true)).toHaveLength(drafts.length);
    const mixed = [...drafts.slice(1), { ...at(drafts, 0), status: 'verified' as const }];
    expect(visibleStates(mixed, false).map((s) => s.state_code)).toEqual([
      at(drafts, 0).state_code,
    ]);
  });

  it('computes Mumbai, woman buyer, ₹1 crore from the data file', () => {
    const v = evaluate(verified, {
      state: 'MH',
      area: 'mumbai',
      buyer: 'female',
      value: '1,00,00,000',
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.result.stampDuty + v.result.surchargesTotal).toBe(500000);
      expect(v.result.registration).toBe(30000);
    }
  });

  it('shows the rule and surcharges in Hindi on the Hindi page, English otherwise', () => {
    const v = evaluate(verified, {
      state: 'MH',
      area: 'mumbai',
      buyer: 'female',
      value: '10000000',
    });
    if (!v.ok) throw new Error('expected a result');
    expect(localizeResult(v.result, 'hi')).toEqual({
      rule: 'मुंबई (BMC सीमा), महिला खरीदार (स्टांप ड्यूटी में 1% छूट)',
      surcharges: [{ name: 'मेट्रो सेस', amount: 100000 }],
    });
    expect(localizeResult(v.result, 'en')).toEqual({
      rule: 'Mumbai (BMC limits), woman buyer (1% concession on stamp duty)',
      surcharges: [{ name: 'Metro cess', amount: 100000 }],
    });
  });

  it('falls back to English when a Hindi text is missing or blank', () => {
    const r = {
      ruleId: 'x',
      ruleDescription: 'Rule',
      ruleDescriptionHi: '  ',
      stampDuty: 1,
      surcharges: [
        { name: 'Cess', amount: 1 },
        { name: 'Tax', nameHi: 'कर', amount: 2 },
      ],
      surchargesTotal: 3,
      registration: 1,
      total: 5,
    };
    expect(localizeResult(r, 'hi')).toEqual({
      rule: 'Rule',
      surcharges: [
        { name: 'Cess', amount: 1 },
        { name: 'कर', amount: 2 },
      ],
    });
  });

  it('works for a state without areas', () => {
    const v = evaluate(verified, { state: 'TN', area: '', buyer: 'male', value: '5000000' });
    expect(v.ok && v.result.total).toBe(450000);
  });

  it('reports the first problem', () => {
    expect(evaluate(verified, { state: 'ZZ', area: '', buyer: 'male', value: '1' })).toEqual({
      ok: false,
      error: 'state',
    });
    expect(evaluate(verified, { state: 'TN', area: '', buyer: 'male', value: '0' })).toEqual({
      ok: false,
      error: 'value',
    });
    expect(evaluate(verified, { state: 'MH', area: 'moon', buyer: 'male', value: '100' })).toEqual({
      ok: false,
      error: 'area',
    });
  });

  it('round-trips through the URL hash, keeping review mode', () => {
    const form = { state: 'KA', area: 'bengaluru', buyer: 'joint' as const, value: '60,00,000' };
    const back = fromHash(toHash(form, true));
    expect(back).toEqual({ showDrafts: true, form: { ...form, value: '6000000' } });
    expect(fromHash(toHash(form, false)).showDrafts).toBe(false);
  });

  it('treats a bare #drafts as review mode and ignores unsafe values', () => {
    expect(fromHash('#drafts')).toEqual({ showDrafts: true, form: {} });
    expect(fromHash('#s=mh&a=<x>&b=robot&v=1e9')).toEqual({ showDrafts: false, form: {} });
  });
});

describe('stamp duty strings', () => {
  it('has the same non-empty keys in EN and HI, with placeholders kept', () => {
    expect(Object.keys(sdStrings.hi).sort()).toEqual(Object.keys(sdStrings.en).sort());
    for (const lang of ['en', 'hi'] as const) {
      for (const [k, v] of Object.entries(sdStrings[lang])) {
        for (const x of Array.isArray(v) ? v : [v]) expect(x.trim(), `${lang}.${k}`).not.toBe('');
      }
      expect(sdStrings[lang].resultRule).toContain('{rule}');
      expect(sdStrings[lang].lastVerified).toContain('{date}');
    }
    expect(sdStrings.hi.formula).toHaveLength(sdStrings.en.formula.length);
    expect(sdStrings.hi.assumptions).toHaveLength(sdStrings.en.assumptions.length);
  });
});
