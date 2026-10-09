import {
  computeEligibility,
  ELIGIBILITY_LIMITS,
  EMI_LIMITS,
  type EligibilityResult,
} from '@toolshop/tools-core';
import { parseAmount } from '../../lib/format.js';

export { formatInr, parseAmount } from '../../lib/format.js';

export interface EligibilityFormState {
  income: string;
  coIncome: string;
  existing: string;
  foir: string;
  rate: string;
  years: string;
  propertyPrice: string;
}

export type EligibilityField = keyof EligibilityFormState;

export type EligibilityView =
  { ok: true; result: EligibilityResult } | { ok: false; errors: EligibilityField[] };

export const DEFAULT_STATE: EligibilityFormState = {
  income: '100000',
  coIncome: '',
  existing: '0',
  foir: '50',
  rate: '8.5',
  years: '20',
  propertyPrice: '',
};

/** Empty means 0 for the optional amounts. */
const optional = (raw: string): number => (raw.trim() === '' ? 0 : parseAmount(raw));
const okAmount = (v: number) => v >= 0 && v <= ELIGIBILITY_LIMITS.maxAmount;

export function evaluate(state: EligibilityFormState): EligibilityView {
  const errors: EligibilityField[] = [];
  const income = parseAmount(state.income);
  const coIncome = optional(state.coIncome);
  const existing = optional(state.existing);
  const foir = parseAmount(state.foir);
  const rate = parseAmount(state.rate);
  const months = Math.round(parseAmount(state.years) * 12);
  const hasPrice = state.propertyPrice.trim() !== '';
  const propertyPrice = optional(state.propertyPrice);

  if (!(income > 0 && income <= ELIGIBILITY_LIMITS.maxAmount)) errors.push('income');
  if (!okAmount(coIncome)) errors.push('coIncome');
  if (!okAmount(existing)) errors.push('existing');
  if (!(foir > 0 && foir <= ELIGIBILITY_LIMITS.maxFoirPercent)) errors.push('foir');
  if (!(rate >= 0 && rate <= EMI_LIMITS.maxAnnualRatePercent)) errors.push('rate');
  if (!(months >= 1 && months <= EMI_LIMITS.maxTenureMonths)) errors.push('years');
  if (!okAmount(propertyPrice)) errors.push('propertyPrice');
  if (!errors.includes('income') && !okAmount(income + coIncome)) errors.push('coIncome');
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    result: computeEligibility({
      monthlyIncome: income + coIncome,
      existingEmis: existing,
      foirPercent: foir,
      annualRatePercent: rate,
      tenureMonths: months,
      ...(hasPrice && propertyPrice > 0 ? { propertyPrice } : {}),
    }),
  };
}

/** "12.5%" — one decimal at most. */
export function formatPercent(value: number): string {
  return `${String(Math.round(value * 10) / 10)}%`;
}

const KEYS: Array<[EligibilityField, string]> = [
  ['income', 'i'],
  ['coIncome', 'c'],
  ['existing', 'e'],
  ['foir', 'f'],
  ['rate', 'r'],
  ['years', 'y'],
  ['propertyPrice', 'p'],
];

/** State lives in the URL hash only (never sent to a server). Empty fields are left out. */
export function toHash(state: EligibilityFormState): string {
  const p = new URLSearchParams();
  for (const [field, key] of KEYS) {
    if (state[field].trim() === '') continue;
    const v = parseAmount(state[field]);
    p.set(key, Number.isFinite(v) ? String(v) : '0');
  }
  return `#${p.toString()}`;
}

const NUM = /^[0-9.]{1,15}$/;

export function fromHash(hash: string): EligibilityFormState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out = { ...DEFAULT_STATE };
  for (const [field, key] of KEYS) {
    const v = p.get(key);
    if (v !== null && NUM.test(v)) out[field] = v;
  }
  return out;
}
