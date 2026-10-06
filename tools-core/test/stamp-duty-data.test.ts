import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeStampDuty, type BuyerGender, type StateRates } from '../src/index.js';

const dir = new URL('../../data/stamp-duty/', import.meta.url);
const states: StateRates[] = readdirSync(dir)
  .filter((f) => /^[A-Z]{2}\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as StateRates);
const byCode = (code: string) => {
  const s = states.find((x) => x.state_code === code);
  if (!s) throw new Error(`missing ${code}`);
  return s;
};

const BUYERS: BuyerGender[] = ['male', 'female', 'joint'];
const VALUES = [500000, 2000000, 2000001, 3000000, 4500000, 4500001, 6000000, 25000000];

describe('stamp-duty data files', () => {
  it('has the five v1 states', () => {
    expect(states.map((s) => s.state_code).sort()).toEqual(['DL', 'KA', 'MH', 'TN', 'UP']);
  });

  it.each(states.map((s) => [s.state_code, s] as const))(
    '%s: every area × buyer × value has a matching rule',
    (_code, s) => {
      const areas = s.areas?.map((a) => a.id) ?? [undefined];
      for (const area of areas)
        for (const buyer of BUYERS)
          for (const value of VALUES) {
            const r = computeStampDuty(s, area ? { value, buyer, area } : { value, buyer });
            expect(r.total).toBeGreaterThan(0);
          }
    },
  );

  it.each(states.map((s) => [s.state_code, s] as const))(
    '%s: rule ids are unique and every rule is reachable by its conditions',
    (_code, s) => {
      const ids = s.rates.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const a of s.areas ?? []) expect(a.label_hi.trim()).not.toBe('');
    },
  );

  it.each(states.map((s) => [s.state_code, s] as const))(
    '%s: every rule description and surcharge name has a Hindi version',
    (_code, s) => {
      for (const rule of s.rates) {
        expect(rule.description_hi?.trim(), rule.id).toBeTruthy();
        for (const sc of rule.surcharges_percent ?? []) {
          expect(sc.name_hi?.trim(), `${rule.id}: ${sc.name}`).toBeTruthy();
        }
      }
    },
  );
});

/**
 * Regression checks that the draft data reproduces what its cited sources state.
 * These do NOT make the data verified — see status/conflicts in each file.
 */
describe('draft data matches its cited sources', () => {
  it('TN: ₹50 lakh → ₹3.5 lakh stamp duty (7%), ₹1 lakh registration (2%)', () => {
    const r = computeStampDuty(byCode('TN'), { value: 5000000, buyer: 'male' });
    expect([r.stampDuty, r.registration]).toEqual([350000, 100000]);
  });

  it('MH: Mumbai 6% (male) / 5% (female) including 1% metro cess; registration capped at ₹30,000', () => {
    const mh = byCode('MH');
    const m = computeStampDuty(mh, { value: 10000000, buyer: 'male', area: 'mumbai' });
    const f = computeStampDuty(mh, { value: 10000000, buyer: 'female', area: 'mumbai' });
    expect(m.stampDuty + m.surchargesTotal).toBe(600000);
    expect(f.stampDuty + f.surchargesTotal).toBe(500000);
    expect(m.registration).toBe(30000);
  });

  it('MH: Pune/Thane/Nagpur 7% (male) / 6% (female)', () => {
    const mh = byCode('MH');
    const m = computeStampDuty(mh, { value: 10000000, buyer: 'male', area: 'pune-thane-nagpur' });
    const f = computeStampDuty(mh, { value: 10000000, buyer: 'female', area: 'pune-thane-nagpur' });
    expect([m.stampDuty + m.surchargesTotal, f.stampDuty + f.surchargesTotal]).toEqual([
      700000, 600000,
    ]);
  });

  it('MH: registration 1% below ₹30 lakh', () => {
    const r = computeStampDuty(byCode('MH'), { value: 2500000, buyer: 'male', area: 'mumbai' });
    expect(r.registration).toBe(25000);
  });

  it('DL: 6% male / 4% female / 5% joint; registration 1% + ₹100', () => {
    const dl = byCode('DL');
    const rows = (['male', 'female', 'joint'] as const).map(
      (buyer) => computeStampDuty(dl, { value: 1000000, buyer }).stampDuty,
    );
    expect(rows).toEqual([60000, 40000, 50000]);
    expect(computeStampDuty(dl, { value: 1000000, buyer: 'male' }).registration).toBe(10100);
  });

  it('KA: 2% up to ₹20 lakh, 3% for ₹20–45 lakh, 5% above ₹45 lakh; +10% cess in Bengaluru', () => {
    const ka = byCode('KA');
    const duty = (value: number, area: string) =>
      computeStampDuty(ka, { value, buyer: 'male', area }).stampDuty;
    expect([duty(1500000, 'other'), duty(3000000, 'other'), duty(6000000, 'other')]).toEqual([
      30000, 90000, 300000,
    ]);
    const blr = computeStampDuty(ka, { value: 6000000, buyer: 'male', area: 'bengaluru' });
    expect(blr.surchargesTotal).toBe(30000); // 10% of ₹3,00,000 → effective 5.5%
  });

  it('UP: 7% male / 6% female; registration 1%', () => {
    const up = byCode('UP');
    expect(computeStampDuty(up, { value: 5000000, buyer: 'male' }).stampDuty).toBe(350000);
    expect(computeStampDuty(up, { value: 5000000, buyer: 'female' }).stampDuty).toBe(300000);
    expect(computeStampDuty(up, { value: 5000000, buyer: 'male' }).registration).toBe(50000);
  });
});
