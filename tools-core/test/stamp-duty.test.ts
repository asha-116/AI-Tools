import { describe, expect, it } from 'vitest';
import { computeStampDuty, STAMP_DUTY_LIMITS, type StateRates } from '../src/index.js';

/** Array access that fails loudly instead of using a non-null assertion. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`missing index ${String(i)}`);
  return v;
}

/** Hand-built fixture: exercises every rule feature with numbers checkable on paper. */
const fixture: StateRates = {
  state: 'Testland',
  state_code: 'TL',
  status: 'verified',
  sources: [{ url: 'https://example.gov.in/rates', title: 'Fixture', accessed: '2026-09-29' }],
  last_verified: '2026-09-29',
  verified_by: 'test fixture',
  areas: [
    { id: 'city', label_en: 'City', label_hi: 'शहर' },
    { id: 'rural', label_en: 'Rural', label_hi: 'ग्रामीण' },
  ],
  rates: [
    {
      id: 'city-female',
      description: 'City, woman buyer',
      description_hi: 'शहर, महिला खरीदार',
      conditions: { area: 'city', buyer_gender: 'female' },
      stamp_duty_percent: 5,
      surcharges_percent: [
        { name: 'Metro cess', name_hi: 'मेट्रो सेस', percent: 1, base: 'value' },
      ],
      registration: { percent: 1, cap_inr: 30000 },
    },
    {
      id: 'city',
      description: 'City, any buyer',
      conditions: { area: 'city' },
      stamp_duty_percent: 6,
      surcharges_percent: [{ name: 'Metro cess', percent: 1, base: 'value' }],
      registration: { percent: 1, cap_inr: 30000 },
    },
    {
      id: 'rural-low',
      description: 'Rural, up to ₹20 lakh',
      conditions: { area: 'rural', max_value_inr: 2000000 },
      stamp_duty_percent: 2,
      surcharges_percent: [{ name: 'Cess on duty', percent: 10, base: 'stamp_duty' }],
      registration: { percent: 1, fixed_fee_inr: 100 },
    },
    {
      id: 'rural-high',
      description: 'Rural, above ₹20 lakh',
      conditions: { area: 'rural', min_value_inr: 2000000 },
      stamp_duty_percent: 5,
      surcharges_percent: [{ name: 'Cess on duty', percent: 10, base: 'stamp_duty' }],
      registration: { percent: 1, min_inr: 1000 },
    },
  ],
};

describe('computeStampDuty — hand-checked cases', () => {
  it.each([
    // [value, area, buyer, stampDuty, surcharges, registration, total, rule]
    [5000000, 'city', 'male', 300000, 50000, 30000, 380000, 'city'], // 6% + 1% cess, reg capped at 30k
    [5000000, 'city', 'female', 250000, 50000, 30000, 330000, 'city-female'], // woman: 5%
    [2500000, 'city', 'joint', 150000, 25000, 25000, 200000, 'city'], // reg 1% under cap
    [2000000, 'rural', 'male', 40000, 4000, 20100, 64100, 'rural-low'], // boundary: ≤ max
    [2000001, 'rural', 'male', 100000.05, 10000.005, 20000.01, 130000.065, 'rural-high'], // just above
    [50000, 'rural', 'female', 1000, 100, 600, 1700, 'rural-low'], // fixed ₹100 fee
  ] as const)(
    '₹%d, %s, %s buyer',
    (value, area, buyer, stampDuty, surcharges, registration, total, rule) => {
      const r = computeStampDuty(fixture, { value, area, buyer });
      expect(r.ruleId).toBe(rule);
      expect(r.stampDuty).toBeCloseTo(stampDuty, 6);
      expect(r.surchargesTotal).toBeCloseTo(surcharges, 6);
      expect(r.registration).toBeCloseTo(registration, 6);
      expect(r.total).toBeCloseTo(total, 6);
    },
  );

  it('applies a registration minimum', () => {
    const high = { ...fixture, rates: [at(fixture.rates, 3)] };
    const r = computeStampDuty(
      { ...high, rates: [{ ...at(fixture.rates, 3), conditions: { area: 'rural' } }] },
      { value: 50000, area: 'rural', buyer: 'male' },
    );
    expect(r.registration).toBe(1000);
  });

  it('itemises surcharges with their names', () => {
    const r = computeStampDuty(fixture, { value: 1000000, area: 'city', buyer: 'male' });
    expect(r.surcharges).toEqual([{ name: 'Metro cess', amount: 10000 }]);
  });

  it('passes Hindi rule and surcharge text through only when the data has it', () => {
    const hi = computeStampDuty(fixture, { value: 1000000, area: 'city', buyer: 'female' });
    expect(hi.ruleDescriptionHi).toBe('शहर, महिला खरीदार');
    expect(hi.surcharges).toEqual([{ name: 'Metro cess', nameHi: 'मेट्रो सेस', amount: 10000 }]);
    const en = computeStampDuty(fixture, { value: 1000000, area: 'city', buyer: 'male' });
    expect('ruleDescriptionHi' in en).toBe(false);
    expect('nameHi' in at(en.surcharges, 0)).toBe(false);
  });

  it('total = stamp duty + surcharges + registration', () => {
    const r = computeStampDuty(fixture, { value: 7777777, area: 'city', buyer: 'joint' });
    expect(r.total).toBeCloseTo(r.stampDuty + r.surchargesTotal + r.registration, 6);
  });

  it('works without areas when the state has none', () => {
    const flat: StateRates = {
      ...fixture,
      areas: undefined,
      rates: [
        {
          id: 'all',
          description: 'All',
          stamp_duty_percent: 7,
          registration: { percent: 2 },
        },
      ],
    };
    const r = computeStampDuty(flat, { value: 5000000, buyer: 'male' });
    expect([r.stampDuty, r.registration, r.total]).toEqual([350000, 100000, 450000]);
  });
});

describe('computeStampDuty — errors', () => {
  it.each([
    [0, /value/],
    [-1, /value/],
    [Number.NaN, /value/],
    [STAMP_DUTY_LIMITS.maxValue + 1, /value/],
  ])('rejects value %d', (value, msg) => {
    expect(() => computeStampDuty(fixture, { value, area: 'city', buyer: 'male' })).toThrow(msg);
  });

  it('rejects an unknown area', () => {
    expect(() => computeStampDuty(fixture, { value: 100000, area: 'moon', buyer: 'male' })).toThrow(
      /area/,
    );
  });

  it('requires an area when the state has areas', () => {
    expect(() => computeStampDuty(fixture, { value: 100000, buyer: 'male' })).toThrow(/area/);
  });

  it('throws when no rule matches', () => {
    const none = { ...fixture, rates: [at(fixture.rates, 0)] };
    expect(() => computeStampDuty(none, { value: 100000, area: 'rural', buyer: 'male' })).toThrow(
      /No rate rule/,
    );
  });
});
