import {
  computePrepayment,
  EMI_LIMITS,
  PREPAYMENT_LIMITS,
  type PrepaymentResult,
} from '@toolshop/tools-core';
import { parseAmount } from '../../lib/format.js';

export { formatInr, parseAmount } from '../../lib/format.js';

export interface PrepayFormState {
  principal: string;
  rate: string;
  years: string;
  lump: string;
  lumpYear: string;
  monthly: string;
  yearly: string;
}

export type PrepayField =
  'principal' | 'rate' | 'years' | 'lump' | 'lumpYear' | 'monthly' | 'yearly';

export type PrepayView =
  { ok: true; result: PrepaymentResult } | { ok: false; errors: PrepayField[] };

export const DEFAULT_STATE: PrepayFormState = {
  principal: '5000000',
  rate: '8.5',
  years: '20',
  lump: '500000',
  lumpYear: '3',
  monthly: '0',
  yearly: '0',
};

/** Empty means 0 for the optional prepayment fields. */
const optional = (raw: string): number => (raw.trim() === '' ? 0 : parseAmount(raw));
const okAmount = (v: number) => v >= 0 && v <= PREPAYMENT_LIMITS.maxAmount;

export function evaluate(state: PrepayFormState): PrepayView {
  const errors: PrepayField[] = [];
  const principal = parseAmount(state.principal);
  const rate = parseAmount(state.rate);
  const years = parseAmount(state.years);
  const lump = optional(state.lump);
  const lumpYear = optional(state.lumpYear);
  const monthly = optional(state.monthly);
  const yearly = optional(state.yearly);
  const months = Math.round(years * 12);

  if (!(principal > 0 && principal <= EMI_LIMITS.maxPrincipal)) errors.push('principal');
  if (!(rate >= 0 && rate <= EMI_LIMITS.maxAnnualRatePercent)) errors.push('rate');
  if (!(months >= 1 && months <= EMI_LIMITS.maxTenureMonths)) errors.push('years');
  if (!okAmount(lump)) errors.push('lump');
  if (!(Number.isInteger(lumpYear) && lumpYear >= 0 && lumpYear * 12 <= months)) {
    errors.push('lumpYear');
  }
  if (!okAmount(monthly)) errors.push('monthly');
  if (!okAmount(yearly)) errors.push('yearly');
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    result: computePrepayment({
      principal,
      annualRatePercent: rate,
      tenureMonths: months,
      lumpSums: lump > 0 ? [{ month: lumpYear * 12, amount: lump }] : [],
      monthlyExtra: monthly,
      yearlyExtra: yearly,
    }),
  };
}

export interface DurationStrings {
  year: string;
  years: string;
  month: string;
  months: string;
  zero: string;
}

/** "16 years 11 months" / "1 year 1 month" (parts dropped when 0). */
export function formatDuration(months: number, t: DurationStrings): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const part = (n: number, one: string, many: string) =>
    n === 0 ? '' : n === 1 ? one : many.replace('{n}', String(n));
  return [part(y, t.year, t.years), part(m, t.month, t.months)].filter(Boolean).join(' ') || t.zero;
}

const KEYS: Array<[keyof PrepayFormState, string]> = [
  ['principal', 'p'],
  ['rate', 'r'],
  ['years', 'y'],
  ['lump', 'l'],
  ['lumpYear', 'ly'],
  ['monthly', 'm'],
  ['yearly', 'a'],
];

/** State lives in the URL hash only (never sent to a server). */
export function toHash(state: PrepayFormState): string {
  const p = new URLSearchParams();
  for (const [field, key] of KEYS) {
    const v = optional(state[field]);
    p.set(key, Number.isFinite(v) ? String(v) : '0');
  }
  return `#${p.toString()}`;
}

const NUM = /^[0-9.]{1,15}$/;

export function fromHash(hash: string): PrepayFormState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out = { ...DEFAULT_STATE };
  for (const [field, key] of KEYS) {
    const v = p.get(key);
    if (v !== null && NUM.test(v)) out[field] = v;
  }
  return out;
}
