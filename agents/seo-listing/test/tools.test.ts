import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allowedNumbers,
  fillPlaceholders,
  findTool,
  placeholderList,
  TOOLS,
  verifiedStates,
  type WorkedExample,
} from '../src/tools.js';

const ROOT = process.cwd();

function example(slug: string, root = ROOT): WorkedExample {
  const e = findTool(slug)?.example(root);
  if (!e || 'unavailable' in e) throw new Error(`no example for ${slug}`);
  return e;
}

const out = (e: WorkedExample, key: string) => e.outputs.find((o) => o.key === key);

describe('worked examples are computed by tools-core (never by a model)', () => {
  it('EMI: ₹10,00,000 at 10.5% for 120 months → ₹13,493 EMI, ₹6,19,220 interest', () => {
    // Published known answer (tools-core/test/fixtures/emi-known-answers.json, case 1).
    const e = example('emi');
    expect(out(e, 'emi')?.display.en).toBe('₹13,493');
    expect(out(e, 'interest')?.display.en).toBe('₹6,19,220');
    expect(out(e, 'total')?.display.hi).toBe('₹16,19,220');
    expect(out(e, 'first_interest')?.display.en).toBe('₹8,750');
  });

  it('Commission: ₹80,00,000 at 2% + 18% GST, split 60/40', () => {
    // 80,00,000 × 2% = 1,60,000; GST 18% = 28,800; 60% = 96,000; 40% = 64,000.
    const e = example('commission');
    expect(out(e, 'gross')?.value).toBe(160_000);
    expect(out(e, 'gst')?.display.en).toBe('₹28,800');
    expect(out(e, 'total')?.display.en).toBe('₹1,88,800');
    expect(out(e, 'me')?.value).toBe(96_000);
    expect(out(e, 'co')?.value).toBe(64_000);
  });

  it('Stamp duty: unavailable while every state is draft', () => {
    expect(verifiedStates(ROOT)).toEqual([]);
    expect(findTool('stamp-duty')?.example(ROOT)).toEqual({
      unavailable: expect.stringContaining('verified') as unknown as string,
    });
    expect(findTool('stamp-duty')?.lastVerified(ROOT)).toBe('not verified');
  });

  it('Stamp duty: uses the first verified state file when there is one', () => {
    const root = mkdtempSync(join(tmpdir(), 'sd-'));
    mkdirSync(join(root, 'data/stamp-duty'), { recursive: true });
    const state = {
      state: 'Testland',
      state_code: 'TL',
      status: 'verified',
      sources: [],
      last_verified: '2026-10-01',
      verified_by: 'test',
      areas: [{ id: 'urban', label_en: 'Urban', label_hi: 'शहरी' }],
      rates: [
        {
          id: 'all',
          description: 'Everyone',
          stamp_duty_percent: 5,
          surcharges_percent: [{ name: 'Cess', percent: 1 }],
          registration: { percent: 1, cap_inr: 30000 },
        },
      ],
    };
    writeFileSync(join(root, 'data/stamp-duty/TL.json'), JSON.stringify(state));
    writeFileSync(join(root, 'data/stamp-duty/schema.json'), '{}');
    const e = example('stamp-duty', root);
    // 50,00,000 × 5% = 2,50,000; cess 1% = 50,000; registration 1% capped at 30,000.
    expect(out(e, 'stamp_duty')?.value).toBe(250_000);
    expect(out(e, 'surcharges')?.value).toBe(50_000);
    expect(out(e, 'registration')?.value).toBe(30_000);
    expect(out(e, 'total')?.display.en).toBe('₹3,30,000');
    expect(e.inputs[1]?.display.hi).toBe('Testland');
    expect(e.source.hi).toContain('Everyone');
    expect(findTool('stamp-duty')?.lastVerified(root)).toBe('2026-10-01');
    expect(verifiedStates(join(root, 'missing'))).toEqual([]);

    // Hindi names are used when the data file has them.
    const hiState = {
      ...state,
      state_name_hi: 'टेस्टलैंड',
      areas: undefined,
      rates: [{ ...state.rates[0], description_hi: 'सभी' }],
    };
    writeFileSync(join(root, 'data/stamp-duty/TL.json'), JSON.stringify(hiState));
    const h = example('stamp-duty', root);
    expect(h.inputs[1]?.display.hi).toBe('टेस्टलैंड');
    expect(h.source.hi).toContain('सभी');
  });
});

describe('registry', () => {
  it('has EN + HI text and paths for every tool', () => {
    for (const t of TOOLS) {
      expect(t.text.en.h1).toBeTruthy();
      expect(t.text.hi.h1).toMatch(/[ऀ-ॿ]/);
      expect(t.text.en.formula.length).toBeGreaterThan(0);
      expect(t.path('en')).toBe(`/tools/${t.slug}/`);
      expect(t.path('hi')).toBe(`/hi/tools/${t.slug}/`);
    }
    expect(findTool('emi')?.lastVerified(ROOT)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(findTool('commission')?.lastVerified(ROOT)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(findTool('nope')).toBeUndefined();
  });
});

describe('placeholders', () => {
  const e = example('emi');

  it('fills known keys per language and reports unknown ones', () => {
    expect(fillPlaceholders('EMI [[emi]] over [[ tenure ]]', e, 'hi')).toEqual({
      text: 'EMI ₹13,493 over 120 महीने (10 साल)',
      unknown: [],
    });
    expect(fillPlaceholders('[[nope]]', e, 'en')).toEqual({ text: '[[nope]]', unknown: ['nope'] });
  });

  it('lists placeholders and allowed numbers', () => {
    expect(placeholderList(e, 'en')).toContain('[[emi]] = ₹13,493 (Monthly EMI)');
    const allowed = allowedNumbers(e);
    expect(allowed).toContain(100);
    expect(allowed).toContain(10.5);
    expect(allowed).toContain(13_493);
  });
});

describe('worked examples for the newer tools match their published answers', () => {
  it('Area: 1 acre = 43,560 sq ft = 4,840 gaj', () => {
    const e = example('area');
    expect(out(e, 'sq_ft')?.display.en).toBe('43,560 sq ft');
    expect(out(e, 'gaj')?.display.hi).toBe('4,840 गज़');
    expect(out(e, 'hectare')?.value).toBeCloseTo(0.4046856, 6);
    // Same 4 decimals as the converter page, not 0.4.
    expect(out(e, 'hectare')?.display.en).toBe('0.4047 hectare');
    expect(out(e, 'sq_m')?.display.en).toBe('4,046.8564 sq m');
    expect(findTool('area')?.moneyTopic).toBe(false);
  });

  it('Prepayment: ₹25 lakh at 9%, ₹2 lakh upfront → 195 months (published)', () => {
    const e = example('prepayment');
    expect(out(e, 'months_new')?.value).toBe(195);
    expect(out(e, 'months_saved')?.display.en).toBe('45 months');
    expect(out(e, 'emi')?.display.en).toBe('₹22,493');
  });

  it('Eligibility: ₹1 lakh, 50%, 8.5%, 20 years → ₹57,61,542 (published, exact)', () => {
    expect(out(example('eligibility'), 'loan')?.display.en).toBe('₹57,61,542');
  });

  it('Carpet area: ₹1.80 crore, 1,500 / 1,050 sq ft → ₹17,143 per carpet sq ft (published)', () => {
    const e = example('carpet-area');
    expect(out(e, 'rate_carpet')?.display.en).toBe('₹17,143');
    expect(out(e, 'rate_sba')?.display.en).toBe('₹12,000');
    expect(out(e, 'loading')?.display.en).toBe('42.86%');
  });

  it('Rental yield: Pune example → 4% gross, 3.33% net (published)', () => {
    const e = example('rental-yield');
    expect(out(e, 'gross')?.display.en).toBe('4%');
    expect(out(e, 'net')?.display.en).toBe('3.33%');
    expect(out(e, 'income')?.display.en).toBe('₹2,00,000');
  });

  it('Rent vs buy: EMI ₹52,069 on ₹60 lakh at 8.5% for 20 years (published ≈ ₹52,000)', () => {
    const e = example('rent-vs-buy');
    expect(out(e, 'emi')?.display.en).toBe('₹52,069');
    expect(out(e, 'buyer')?.value).toBeGreaterThan(0);
    expect(out(e, 'renter')?.value).toBeGreaterThan(0);
  });

  it('every tool page on the site has an adapter, and every adapter has text and a formula', () => {
    expect(TOOLS.map((t) => t.slug).sort()).toEqual(
      readdirSync(join(ROOT, 'site/src/tools')).sort(),
    );
    for (const t of TOOLS) {
      for (const lang of ['en', 'hi'] as const) {
        expect(t.text[lang].h1.length, `${t.slug} ${lang}`).toBeGreaterThan(0);
        expect(t.text[lang].formula.length, `${t.slug} ${lang}`).toBeGreaterThan(0);
      }
      expect(t.path('hi')).toBe(`/hi/tools/${t.slug}/`);
      expect(t.lastVerified(ROOT)).toMatch(/^\d{4}-\d{2}-\d{2}$|not verified/);
    }
  });
});
