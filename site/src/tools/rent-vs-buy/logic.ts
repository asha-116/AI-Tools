import {
  computeRentVsBuy,
  EMI_LIMITS,
  RENT_VS_BUY_LIMITS,
  type RentVsBuyResult,
} from '@toolshop/tools-core';
import { parseAmount } from '../../lib/format.js';

export { formatInr, parseAmount } from '../../lib/format.js';

export interface RvbFormState {
  propertyValue: string;
  downPayment: string;
  purchaseCosts: string;
  rate: string;
  loanYears: string;
  ownerCosts: string;
  appreciation: string;
  rent: string;
  rentIncrease: string;
  investReturn: string;
  years: string;
}

export type RvbField = keyof RvbFormState;

export type RvbView = { ok: true; result: RentVsBuyResult } | { ok: false; errors: RvbField[] };

export const DEFAULT_STATE: RvbFormState = {
  propertyValue: '7500000',
  downPayment: '1500000',
  purchaseCosts: '500000',
  rate: '8.5',
  loanYears: '20',
  ownerCosts: '30000',
  appreciation: '5',
  rent: '25000',
  rentIncrease: '5',
  investReturn: '8',
  years: '10',
};

/** Empty means 0 for the optional fields. */
const optional = (raw: string): number => (raw.trim() === '' ? 0 : parseAmount(raw));
const { maxAmount, maxPercent, maxYears } = RENT_VS_BUY_LIMITS;
const okAmount = (v: number, positive: boolean) => (positive ? v > 0 : v >= 0) && v <= maxAmount;
const okPercent = (v: number, min = 0) => v >= min && v <= maxPercent;

export function evaluate(state: RvbFormState): RvbView {
  const errors: RvbField[] = [];
  const propertyValue = parseAmount(state.propertyValue);
  const downPayment = parseAmount(state.downPayment);
  const purchaseCosts = optional(state.purchaseCosts);
  const rate = parseAmount(state.rate);
  const months = Math.round(parseAmount(state.loanYears) * 12);
  const ownerCosts = optional(state.ownerCosts);
  const appreciation = optional(state.appreciation);
  const rent = parseAmount(state.rent);
  const rentIncrease = optional(state.rentIncrease);
  const investReturn = optional(state.investReturn);
  const years = parseAmount(state.years);

  if (!okAmount(propertyValue, true)) errors.push('propertyValue');
  if (
    !okAmount(downPayment, false) ||
    (okAmount(propertyValue, true) && downPayment > propertyValue)
  )
    errors.push('downPayment');
  if (!okAmount(purchaseCosts, false)) errors.push('purchaseCosts');
  if (!(rate >= 0 && rate <= EMI_LIMITS.maxAnnualRatePercent)) errors.push('rate');
  if (!(months >= 1 && months <= EMI_LIMITS.maxTenureMonths)) errors.push('loanYears');
  if (!okAmount(ownerCosts, false)) errors.push('ownerCosts');
  if (!okPercent(appreciation, -maxPercent)) errors.push('appreciation');
  if (!okAmount(rent, true)) errors.push('rent');
  if (!okPercent(rentIncrease)) errors.push('rentIncrease');
  if (!okPercent(investReturn)) errors.push('investReturn');
  if (!(Number.isInteger(years) && years >= 1 && years <= maxYears)) errors.push('years');
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    result: computeRentVsBuy({
      propertyValue,
      downPayment,
      purchaseCosts,
      annualRatePercent: rate,
      tenureMonths: months,
      ownerYearlyCosts: ownerCosts,
      appreciationPercent: appreciation,
      monthlyRent: rent,
      rentIncreasePercent: rentIncrease,
      investReturnPercent: investReturn,
      years,
    }),
  };
}

/** "₹12,34,567" or "−₹12,34,567" — the sign is shown, never hidden. */
export function formatSignedInr(value: number, format: (v: number) => string): string {
  return value < 0 ? `−${format(-value)}` : format(value);
}

const KEYS: Array<[RvbField, string]> = [
  ['propertyValue', 'v'],
  ['downPayment', 'd'],
  ['purchaseCosts', 'p'],
  ['rate', 'r'],
  ['loanYears', 'n'],
  ['ownerCosts', 'o'],
  ['appreciation', 'a'],
  ['rent', 'm'],
  ['rentIncrease', 'i'],
  ['investReturn', 'g'],
  ['years', 'y'],
];

/** State lives in the URL hash only (never sent to a server). Empty fields are left out. */
export function toHash(state: RvbFormState): string {
  const p = new URLSearchParams();
  for (const [field, key] of KEYS) {
    if (state[field].trim() === '') continue;
    const v = parseAmount(state[field]);
    p.set(key, Number.isFinite(v) ? String(v) : '0');
  }
  return `#${p.toString()}`;
}

const NUM = /^-?[0-9.]{1,15}$/;

export function fromHash(hash: string): RvbFormState {
  const raw = hash.replace(/^#/, '');
  const p = new URLSearchParams(raw);
  // A shared link sets exactly the fields it carries; the rest are empty.
  const out: RvbFormState =
    raw === ''
      ? { ...DEFAULT_STATE }
      : (Object.fromEntries(KEYS.map(([f]) => [f, ''])) as unknown as RvbFormState);
  for (const [field, key] of KEYS) {
    const v = p.get(key);
    if (v !== null && NUM.test(v)) out[field] = v;
  }
  return out;
}
