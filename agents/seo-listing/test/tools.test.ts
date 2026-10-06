import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
