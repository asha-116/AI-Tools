import { describe, expect, it } from 'vitest';
import known from './fixtures/commission-known-answers.json' with { type: 'json' };
import { COMMISSION_LIMITS, computeCommission, type CommissionInput } from '../src/index.js';

describe('computeCommission — published known answers', () => {
  it('has at least 10 sourced cases', () => {
    expect(known.cases.length).toBeGreaterThanOrEqual(10);
    for (const c of known.cases) expect(c.sources.length).toBeGreaterThan(0);
  });

  it.each(known.cases)('$name', ({ input, expect: e }) => {
    const r = computeCommission(input as CommissionInput);
    expect(r.gross).toBe(e.gross);
    expect(r.gst).toBe(e.gst);
    expect(r.totalPayable).toBe(e.totalPayable);
    expect(r.parties.map((p) => p.amount)).toEqual(e.parties);
  });
});

const base: CommissionInput = {
  dealValue: 7500000,
  commission: { type: 'percent', percent: 1.5 },
  gstPercent: 0,
  parties: [{ label: 'A', percent: 100 }],
};

describe('computeCommission — rounding and allocation', () => {
  it('splits to the paisa and the shares always add up to the gross', () => {
    const r = computeCommission({
      ...base,
      commission: { type: 'fixed', amount: 100 },
      parties: [
        { label: 'A', percent: 33.33 },
        { label: 'B', percent: 33.33 },
        { label: 'C', percent: 33.34 },
      ],
    });
    expect(r.parties.map((p) => p.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(r.parties.reduce((s, p) => s + Math.round(p.amount * 100), 0)).toBe(10000);
  });

  it('gives leftover paise to the largest remainders (ties: first party)', () => {
    // ₹0.10 three ways at 1/3 each → 3.33 + 3.33 + 3.33 paise; one paisa left over.
    const third = 100 / 3;
    const r = computeCommission({
      ...base,
      commission: { type: 'fixed', amount: 0.1 },
      parties: [
        { label: 'A', percent: third },
        { label: 'B', percent: third },
        { label: 'C', percent: third },
      ],
    });
    expect(r.parties.map((p) => p.amount)).toEqual([0.04, 0.03, 0.03]);
  });

  it('never loses a paisa across many awkward splits', () => {
    for (let paise = 1; paise <= 2000; paise += 37) {
      const r = computeCommission({
        ...base,
        commission: { type: 'fixed', amount: paise / 100 },
        parties: [
          { label: 'A', percent: 12.5 },
          { label: 'B', percent: 45.5 },
          { label: 'C', percent: 42 },
        ],
      });
      const sum = r.parties.reduce((s, p) => s + Math.round(p.amount * 100), 0);
      expect(sum).toBe(paise);
    }
  });

  it('rounds gross and GST to the paisa', () => {
    const r = computeCommission({
      ...base,
      dealValue: 1234567,
      commission: { type: 'percent', percent: 1.25 },
      gstPercent: 18,
    });
    expect(r.gross).toBe(15432.09); // 15432.0875
    expect(r.gst).toBe(2777.78); // 18% of 15432.09 = 2777.7762
    expect(r.totalPayable).toBe(18209.87);
  });

  it('echoes party labels and percents', () => {
    const r = computeCommission({
      ...base,
      parties: [
        { label: 'Me', percent: 60 },
        { label: 'Co-broker', percent: 40 },
      ],
    });
    expect(r.parties).toEqual([
      { label: 'Me', percent: 60, amount: 67500 },
      { label: 'Co-broker', percent: 40, amount: 45000 },
    ]);
  });
});

describe('computeCommission — input validation', () => {
  it.each([
    ['missing deal value', { ...base, dealValue: undefined }, /dealValue/],
    ['zero deal value', { ...base, dealValue: 0 }, /dealValue/],
    ['huge deal value', { ...base, dealValue: COMMISSION_LIMITS.maxDealValue + 1 }, /dealValue/],
    ['negative percent', { ...base, commission: { type: 'percent', percent: -1 } }, /percent/],
    [
      'percent too high',
      {
        ...base,
        commission: { type: 'percent', percent: COMMISSION_LIMITS.maxCommissionPercent + 1 },
      },
      /percent/,
    ],
    ['zero fixed amount', { ...base, commission: { type: 'fixed', amount: 0 } }, /amount/],
    ['GST out of range', { ...base, gstPercent: 29 }, /gstPercent/],
    ['no parties', { ...base, parties: [] }, /parties/],
    [
      'too many parties',
      {
        ...base,
        parties: Array.from({ length: COMMISSION_LIMITS.maxParties + 1 }, (_, i) => ({
          label: String(i),
          percent: 100 / (COMMISSION_LIMITS.maxParties + 1),
        })),
      },
      /parties/,
    ],
    [
      'shares not adding to 100',
      {
        ...base,
        parties: [
          { label: 'A', percent: 60 },
          { label: 'B', percent: 30 },
        ],
      },
      /100/,
    ],
    [
      'negative share',
      {
        ...base,
        parties: [
          { label: 'A', percent: 110 },
          { label: 'B', percent: -10 },
        ],
      },
      /share/,
    ],
  ])('rejects %s', (_name, input, message) => {
    expect(() => computeCommission(input as CommissionInput)).toThrow(message);
  });

  it('fixed mode ignores deal value', () => {
    const r = computeCommission({
      ...base,
      dealValue: undefined,
      commission: { type: 'fixed', amount: 5000 },
    });
    expect(r.gross).toBe(5000);
  });
});
