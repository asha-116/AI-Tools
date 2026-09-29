import { describe, expect, it } from 'vitest';
import {
  defaultState,
  evaluate,
  fromHash,
  MAX_LABEL,
  sharesTotal,
  toHash,
  type CommissionFormState,
} from '../src/tools/commission/logic.js';
import { commissionStrings } from '../src/tools/commission/strings.js';

const dflt = defaultState(['Me', 'Co-broker']);

describe('commission page logic', () => {
  it('default: ₹75 lakh at 1%, 50/50 → ₹75,000 split ₹37,500 each', () => {
    const v = evaluate(dflt);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.result.gross).toBe(75000);
      expect(v.result.parties.map((p) => p.amount)).toEqual([37500, 37500]);
    }
  });

  it('matches a published known answer through the page path (₹1 crore, 2%, 18% GST)', () => {
    const v = evaluate({
      ...dflt,
      deal: '1,00,00,000',
      rate: '2',
      gst: '18',
      parties: [{ label: 'Me', share: '100' }],
    });
    expect(v.ok && [v.result.gross, v.result.gst, v.result.totalPayable]).toEqual([
      200000, 36000, 236000,
    ]);
  });

  it('fixed mode uses the amount and ignores the deal value', () => {
    const v = evaluate({ ...dflt, mode: 'fixed', amount: '6,000', deal: '' });
    expect(v.ok && v.result.parties.map((p) => p.amount)).toEqual([3000, 3000]);
  });

  it('treats an empty GST field as 0', () => {
    const v = evaluate({ ...dflt, gst: ' ' });
    expect(v.ok && v.result.gst).toBe(0);
  });

  it('reports every invalid field and the shares total', () => {
    const v = evaluate({
      ...dflt,
      deal: '0',
      rate: '25',
      gst: '30',
      parties: [
        { label: 'A', share: '60' },
        { label: 'B', share: '30' },
      ],
    });
    expect(v).toEqual({ ok: false, errors: ['deal', 'rate', 'gst', 'shares'], sharesTotal: 90 });
    expect(evaluate({ ...dflt, mode: 'fixed', amount: '' })).toMatchObject({ errors: ['amount'] });
    expect(evaluate({ ...dflt, parties: [] })).toMatchObject({ errors: ['shares'] });
    expect(
      evaluate({
        ...dflt,
        parties: [
          { label: 'A', share: '110' },
          { label: 'B', share: '-10' },
        ],
      }),
    ).toMatchObject({ errors: ['shares'] });
  });

  it('sums shares, counting blanks as 0', () => {
    expect(
      sharesTotal([
        { label: '', share: '33.33' },
        { label: '', share: '' },
        { label: '', share: '66.67' },
      ]),
    ).toBeCloseTo(100, 10);
  });

  it('round-trips percent mode through the hash, including labels with spaces', () => {
    const state: CommissionFormState = {
      ...dflt,
      gst: '18',
      parties: [
        { label: 'Ravi & Co', share: '60' },
        { label: 'मैं', share: '40' },
      ],
    };
    const back = fromHash(toHash(state), dflt);
    expect(back).toEqual({ ...state, amount: '' });
  });

  it('round-trips fixed mode', () => {
    const state: CommissionFormState = { ...dflt, mode: 'fixed', amount: '15000' };
    const back = fromHash(toHash(state), dflt);
    expect(back.mode).toBe('fixed');
    expect(back.amount).toBe('15000');
  });

  it('sanitises hostile or missing hash values', () => {
    expect(fromHash('', dflt)).toEqual(dflt);
    const long = 'x'.repeat(100);
    const back = fromHash(`#m=p&d=<b>&r=1e9&s=abc~${long}&s=40`, dflt);
    expect(back.deal).toBe(dflt.deal);
    expect(back.rate).toBe(dflt.rate);
    expect(back.parties).toEqual([
      { share: '0', label: 'x'.repeat(MAX_LABEL) },
      { share: '40', label: '' },
    ]);
    const many = Array.from({ length: 10 }, () => 's=10~a').join('&');
    expect(fromHash(`#${many}`, dflt).parties).toHaveLength(6);
  });
});

describe('commission strings', () => {
  it('has the same non-empty keys in EN and HI', () => {
    expect(Object.keys(commissionStrings.hi).sort()).toEqual(
      Object.keys(commissionStrings.en).sort(),
    );
    for (const lang of ['en', 'hi'] as const) {
      for (const [k, v] of Object.entries(commissionStrings[lang])) {
        for (const x of Array.isArray(v) ? v : [v]) expect(x.trim(), `${lang}.${k}`).not.toBe('');
      }
      expect(commissionStrings[lang].sharesTotal).toContain('{total}');
    }
  });
});
