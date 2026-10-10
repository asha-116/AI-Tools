import {
  BALANCE_TRANSFER_LIMITS,
  computeBalanceTransfer,
  EMI_LIMITS,
  type BalanceTransferResult,
} from '@toolshop/tools-core';
import { formatInr, parseAmount } from '../../lib/format.js';

export { formatInr, parseAmount } from '../../lib/format.js';

export interface TransferFormState {
  outstanding: string;
  currentRate: string;
  yearsLeft: string;
  newRate: string;
  newYears: string;
  switchingCosts: string;
}

export type TransferField = keyof TransferFormState;

export type TransferView =
  { ok: true; result: BalanceTransferResult } | { ok: false; errors: TransferField[] };

export const DEFAULT_STATE: TransferFormState = {
  outstanding: '3939000',
  currentRate: '8',
  yearsLeft: '15',
  newRate: '7',
  newYears: '',
  switchingCosts: '25000',
};

const filled = (raw: string) => raw.trim() !== '';
const okRate = (v: number) => v >= 0 && v <= EMI_LIMITS.maxAnnualRatePercent;

/** Years (decimals allowed) → whole months; NaN when out of range. */
export function toMonths(raw: string): number {
  const m = Math.round(parseAmount(raw) * 12);
  return m >= 1 && m <= EMI_LIMITS.maxTenureMonths ? m : Number.NaN;
}

export function evaluate(state: TransferFormState): TransferView {
  const errors: TransferField[] = [];
  const outstanding = parseAmount(state.outstanding);
  const currentRate = parseAmount(state.currentRate);
  const remainingMonths = toMonths(state.yearsLeft);
  const newRate = parseAmount(state.newRate);
  const newTenureMonths = filled(state.newYears) ? toMonths(state.newYears) : remainingMonths;
  const switchingCosts = filled(state.switchingCosts) ? parseAmount(state.switchingCosts) : 0;

  if (!(outstanding > 0 && outstanding <= BALANCE_TRANSFER_LIMITS.maxAmount)) {
    errors.push('outstanding');
  }
  if (!okRate(currentRate)) errors.push('currentRate');
  if (Number.isNaN(remainingMonths)) errors.push('yearsLeft');
  if (!okRate(newRate)) errors.push('newRate');
  if (filled(state.newYears) && Number.isNaN(newTenureMonths)) errors.push('newYears');
  if (!(switchingCosts >= 0 && switchingCosts <= BALANCE_TRANSFER_LIMITS.maxAmount)) {
    errors.push('switchingCosts');
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    result: computeBalanceTransfer({
      outstanding,
      currentRatePercent: currentRate,
      remainingMonths,
      newRatePercent: newRate,
      newTenureMonths,
      switchingCosts,
    }),
  };
}

/** "−₹1,234" for a loss, "₹1,234" otherwise. */
export function formatSigned(value: number): string {
  const rounded = Math.round(value) || 0; // never "−₹0"
  return rounded < 0 ? `−${formatInr(-rounded)}` : formatInr(rounded);
}

const KEYS: Array<[TransferField, string]> = [
  ['outstanding', 'o'],
  ['currentRate', 'r'],
  ['yearsLeft', 'y'],
  ['newRate', 'n'],
  ['newYears', 't'],
  ['switchingCosts', 'c'],
];

/** State lives in the URL hash only (never sent to a server). Empty fields are left out. */
export function toHash(state: TransferFormState): string {
  const p = new URLSearchParams();
  for (const [field, key] of KEYS) {
    if (!filled(state[field])) continue;
    const v = parseAmount(state[field]);
    p.set(key, Number.isFinite(v) ? String(v) : '0');
  }
  return `#${p.toString()}`;
}

const NUM = /^[0-9.]{1,15}$/;

export function fromHash(hash: string): TransferFormState {
  const raw = hash.replace(/^#/, '');
  const p = new URLSearchParams(raw);
  // A shared link sets exactly the fields it carries; the rest are empty.
  const out: TransferFormState =
    raw === ''
      ? { ...DEFAULT_STATE }
      : {
          outstanding: '',
          currentRate: '',
          yearsLeft: '',
          newRate: '',
          newYears: '',
          switchingCosts: '',
        };
  for (const [field, key] of KEYS) {
    const v = p.get(key);
    if (v !== null && NUM.test(v)) out[field] = v;
  }
  return out;
}
