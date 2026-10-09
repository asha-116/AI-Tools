import {
  computeRentalYield,
  RENTAL_YIELD_LIMITS,
  type RentalYieldResult,
} from '@toolshop/tools-core';
import { parseAmount } from '../../lib/format.js';

export { formatInr, parseAmount } from '../../lib/format.js';

export interface YieldFormState {
  propertyValue: string;
  purchaseCosts: string;
  monthlyRent: string;
  vacancyMonths: string;
  yearlyCosts: string;
}

export type YieldField = keyof YieldFormState;

export type YieldView =
  { ok: true; result: RentalYieldResult } | { ok: false; errors: YieldField[] };

export const DEFAULT_STATE: YieldFormState = {
  propertyValue: '6000000',
  purchaseCosts: '',
  monthlyRent: '20000',
  vacancyMonths: '0.5',
  yearlyCosts: '30000',
};

/** Empty means 0 for the optional amounts. */
const optional = (raw: string): number => (raw.trim() === '' ? 0 : parseAmount(raw));
const okAmount = (v: number, positive: boolean) =>
  (positive ? v > 0 : v >= 0) && v <= RENTAL_YIELD_LIMITS.maxAmount;

export function evaluate(state: YieldFormState): YieldView {
  const errors: YieldField[] = [];
  const propertyValue = parseAmount(state.propertyValue);
  const purchaseCosts = optional(state.purchaseCosts);
  const monthlyRent = parseAmount(state.monthlyRent);
  const vacancyMonths = optional(state.vacancyMonths);
  const yearlyCosts = optional(state.yearlyCosts);

  if (!okAmount(propertyValue, true)) errors.push('propertyValue');
  if (!okAmount(purchaseCosts, false)) errors.push('purchaseCosts');
  if (!okAmount(monthlyRent, true)) errors.push('monthlyRent');
  if (!(vacancyMonths >= 0 && vacancyMonths <= 12)) errors.push('vacancyMonths');
  if (!okAmount(yearlyCosts, false)) errors.push('yearlyCosts');
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    result: computeRentalYield({
      propertyValue,
      monthlyRent,
      purchaseCosts,
      yearlyCosts,
      vacancyMonths,
    }),
  };
}

/** "3.33%" — two decimals at most (yields are small numbers). */
export function formatPercent(value: number): string {
  return `${String(Math.round(value * 100) / 100)}%`;
}

/** "30" / "26.7" — one decimal at most. */
export function formatYears(value: number): string {
  return String(Math.round(value * 10) / 10);
}

const KEYS: Array<[YieldField, string]> = [
  ['propertyValue', 'v'],
  ['purchaseCosts', 'p'],
  ['monthlyRent', 'r'],
  ['vacancyMonths', 'e'],
  ['yearlyCosts', 'c'],
];

/** State lives in the URL hash only (never sent to a server). Empty fields are left out. */
export function toHash(state: YieldFormState): string {
  const p = new URLSearchParams();
  for (const [field, key] of KEYS) {
    if (state[field].trim() === '') continue;
    const v = parseAmount(state[field]);
    p.set(key, Number.isFinite(v) ? String(v) : '0');
  }
  return `#${p.toString()}`;
}

const NUM = /^[0-9.]{1,15}$/;

export function fromHash(hash: string): YieldFormState {
  const raw = hash.replace(/^#/, '');
  const p = new URLSearchParams(raw);
  // A shared link sets exactly the fields it carries; the rest are empty.
  const out: YieldFormState =
    raw === ''
      ? { ...DEFAULT_STATE }
      : {
          propertyValue: '',
          purchaseCosts: '',
          monthlyRent: '',
          vacancyMonths: '',
          yearlyCosts: '',
        };
  for (const [field, key] of KEYS) {
    const v = p.get(key);
    if (v !== null && NUM.test(v)) out[field] = v;
  }
  return out;
}
