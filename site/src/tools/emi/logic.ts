import { computeEmi, EMI_LIMITS, type EmiResult } from '@toolshop/tools-core';
import { parseAmount } from '../../lib/format.js';

export { formatInr, parseAmount } from '../../lib/format.js';

/** Everything the page needs, derived from raw form/URL values. Pure — unit-tested. */
export interface EmiFormState {
  principal: string;
  rate: string;
  tenure: string;
  unit: 'years' | 'months';
}

export type EmiView =
  | { ok: true; result: EmiResult; months: number }
  | { ok: false; errors: Array<'principal' | 'rate' | 'tenure'> };

export const DEFAULT_STATE: EmiFormState = {
  principal: '2500000',
  rate: '8.5',
  tenure: '20',
  unit: 'years',
};

export function evaluate(state: EmiFormState): EmiView {
  const principal = parseAmount(state.principal);
  const rate = parseAmount(state.rate);
  const tenure = parseAmount(state.tenure);
  const months = state.unit === 'years' ? Math.round(tenure * 12) : tenure;

  const errors: Array<'principal' | 'rate' | 'tenure'> = [];
  if (!(principal > 0 && principal <= EMI_LIMITS.maxPrincipal)) errors.push('principal');
  if (!(rate >= 0 && rate <= EMI_LIMITS.maxAnnualRatePercent)) errors.push('rate');
  if (!(Number.isInteger(months) && months >= 1 && months <= EMI_LIMITS.maxTenureMonths)) {
    errors.push('tenure');
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    months,
    result: computeEmi({ principal, annualRatePercent: rate, tenureMonths: months }),
  };
}

/** Inputs live in the URL *hash*, which browsers never send to a server. */
export function toHash(state: EmiFormState): string {
  const p = new URLSearchParams({
    p: String(parseAmount(state.principal)),
    r: state.rate.trim(),
    t: state.tenure.trim(),
    u: state.unit === 'months' ? 'm' : 'y',
  });
  return `#${p.toString()}`;
}

export function fromHash(hash: string): EmiFormState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const pick = (key: string, fallback: string) => {
    const v = p.get(key);
    return v !== null && /^[0-9.]{1,15}$/.test(v) ? v : fallback;
  };
  return {
    principal: pick('p', DEFAULT_STATE.principal),
    rate: pick('r', DEFAULT_STATE.rate),
    tenure: pick('t', DEFAULT_STATE.tenure),
    unit: p.get('u') === 'm' ? 'months' : 'years',
  };
}
