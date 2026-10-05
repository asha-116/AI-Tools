import { assertFiniteNumber } from './numbers.js';

/**
 * Stamp duty + surcharges + registration fee for one state, driven entirely by a data file
 * (data/stamp-duty/<STATE>.json, schema in data/stamp-duty/schema.json). No rate is hard-coded.
 *
 * Rule matching: the FIRST rule whose conditions all match is used.
 *   min_value_inr: applies when value >  min   (exclusive)
 *   max_value_inr: applies when value <= max   (inclusive)
 * Outputs are unrounded; round only for display.
 */
export type BuyerGender = 'male' | 'female' | 'joint';

export interface Surcharge {
  name: string;
  percent: number;
  /** 'value' (default): % of the property value. 'stamp_duty': % of the stamp duty. */
  base?: 'value' | 'stamp_duty';
}

export interface RateRule {
  id: string;
  description: string;
  conditions?: {
    area?: string;
    buyer_gender?: BuyerGender | 'any';
    property_type?: 'residential' | 'commercial' | 'land' | 'any';
    min_value_inr?: number;
    max_value_inr?: number;
  };
  stamp_duty_percent: number;
  surcharges_percent?: Surcharge[];
  registration: {
    percent: number;
    cap_inr?: number | null;
    min_inr?: number | null;
    /** Flat fee added on top of the percentage, e.g. a pasting/scanning fee. */
    fixed_fee_inr?: number;
  };
}

export interface StateRates {
  state: string;
  state_name_hi?: string;
  state_code: string;
  status: 'draft' | 'verified';
  /** Government page to verify the rates against. */
  official_source?: string;
  sources: { url: string; title: string; accessed: string }[];
  last_verified: string;
  verified_by: string;
  notes?: string;
  conflicts?: string[];
  areas?: { id: string; label_en: string; label_hi: string }[] | undefined;
  rates: RateRule[];
}

export interface StampDutyInput {
  value: number;
  buyer: BuyerGender;
  area?: string;
}

export interface StampDutyResult {
  ruleId: string;
  ruleDescription: string;
  stampDuty: number;
  surcharges: { name: string; amount: number }[];
  surchargesTotal: number;
  registration: number;
  total: number;
}

export const STAMP_DUTY_LIMITS = { maxValue: 10_000_000_000 } as const; // ₹1,000 crore

export function computeStampDuty(data: StateRates, input: StampDutyInput): StampDutyResult {
  const { value, buyer, area } = input;
  assertFiniteNumber(value, 'value');
  if (value <= 0 || value > STAMP_DUTY_LIMITS.maxValue) {
    throw new RangeError(`value must be > 0 and ≤ ${String(STAMP_DUTY_LIMITS.maxValue)}`);
  }
  if (data.areas && data.areas.length > 0) {
    if (area === undefined || !data.areas.some((a) => a.id === area)) {
      throw new RangeError(`area must be one of: ${data.areas.map((a) => a.id).join(', ')}`);
    }
  }

  const rule = data.rates.find((r) => matches(r, value, buyer, area));
  if (!rule) throw new RangeError(`No rate rule in ${data.state_code} matches this input`);

  const stampDuty = (value * rule.stamp_duty_percent) / 100;
  const surcharges = (rule.surcharges_percent ?? []).map((s) => ({
    name: s.name,
    amount: ((s.base === 'stamp_duty' ? stampDuty : value) * s.percent) / 100,
  }));
  const surchargesTotal = surcharges.reduce((sum, s) => sum + s.amount, 0);

  const reg = rule.registration;
  let registration = (value * reg.percent) / 100;
  if (reg.cap_inr != null) registration = Math.min(registration, reg.cap_inr);
  if (reg.min_inr != null) registration = Math.max(registration, reg.min_inr);
  registration += reg.fixed_fee_inr ?? 0;

  return {
    ruleId: rule.id,
    ruleDescription: rule.description,
    stampDuty,
    surcharges,
    surchargesTotal,
    registration,
    total: stampDuty + surchargesTotal + registration,
  };
}

function matches(rule: RateRule, value: number, buyer: BuyerGender, area?: string): boolean {
  const c = rule.conditions;
  if (!c) return true;
  if (c.area !== undefined && c.area !== area) return false;
  if (c.buyer_gender !== undefined && c.buyer_gender !== 'any' && c.buyer_gender !== buyer) {
    return false;
  }
  if (c.min_value_inr !== undefined && !(value > c.min_value_inr)) return false;
  if (c.max_value_inr !== undefined && !(value <= c.max_value_inr)) return false;
  return true;
}
