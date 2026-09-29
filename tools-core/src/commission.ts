import { assertFiniteNumber } from './numbers.js';

/**
 * Brokerage commission, optional GST on top, and a split between parties.
 *
 *   gross        = deal value × commission %   (or a fixed amount)
 *   GST          = gross × GST %                (user-entered; 0 if not charged)
 *   party amount = gross × party share %        (shares add up to 100%)
 *
 * All money is computed in whole paise so party amounts always add up to the gross exactly;
 * leftover paise go to the largest remainders (ties: earlier party).
 * Known answers: tools-core/test/fixtures/commission-known-answers.json.
 */
export interface CommissionParty {
  label: string;
  /** Share of the gross commission, in percent. */
  percent: number;
}

export interface CommissionInput {
  /** Property deal value in ₹. Required when commission.type is 'percent'. */
  dealValue?: number | undefined;
  commission: { type: 'percent'; percent: number } | { type: 'fixed'; amount: number };
  /** GST percent charged on the commission; 0 when not charged. */
  gstPercent: number;
  parties: CommissionParty[];
}

export interface CommissionResult {
  gross: number;
  gst: number;
  totalPayable: number;
  parties: Array<CommissionParty & { amount: number }>;
}

export const COMMISSION_LIMITS = {
  maxDealValue: 10_000_000_000, // ₹1,000 crore
  maxCommissionPercent: 20,
  maxFixedAmount: 1_000_000_000,
  maxGstPercent: 28,
  maxParties: 6,
} as const;

export function computeCommission(input: CommissionInput): CommissionResult {
  const grossPaise = grossInPaise(input);

  assertFiniteNumber(input.gstPercent, 'gstPercent');
  if (input.gstPercent < 0 || input.gstPercent > COMMISSION_LIMITS.maxGstPercent) {
    throw new RangeError(
      `gstPercent must be between 0 and ${String(COMMISSION_LIMITS.maxGstPercent)}`,
    );
  }
  const gstPaise = Math.round((grossPaise * input.gstPercent) / 100);

  const { parties } = input;
  if (parties.length < 1 || parties.length > COMMISSION_LIMITS.maxParties) {
    throw new RangeError(`parties must have 1 to ${String(COMMISSION_LIMITS.maxParties)} entries`);
  }
  let sum = 0;
  for (const p of parties) {
    assertFiniteNumber(p.percent, 'party share');
    if (p.percent < 0) throw new RangeError('party share must be ≥ 0');
    sum += p.percent;
  }
  if (Math.abs(sum - 100) > 1e-6) {
    throw new RangeError(`party shares must add up to 100, got ${String(sum)}`);
  }

  const amounts = allocate(
    grossPaise,
    parties.map((p) => p.percent),
  );
  return {
    gross: grossPaise / 100,
    gst: gstPaise / 100,
    totalPayable: (grossPaise + gstPaise) / 100,
    parties: parties.map((p, i) => ({
      label: p.label,
      percent: p.percent,
      amount: (amounts[i] ?? 0) / 100,
    })),
  };
}

function grossInPaise({ dealValue, commission }: CommissionInput): number {
  if (commission.type === 'fixed') {
    assertFiniteNumber(commission.amount, 'amount');
    if (commission.amount <= 0 || commission.amount > COMMISSION_LIMITS.maxFixedAmount) {
      throw new RangeError(`amount must be > 0 and ≤ ${String(COMMISSION_LIMITS.maxFixedAmount)}`);
    }
    return Math.round(commission.amount * 100);
  }
  if (
    dealValue === undefined ||
    !Number.isFinite(dealValue) ||
    dealValue <= 0 ||
    dealValue > COMMISSION_LIMITS.maxDealValue
  ) {
    throw new RangeError(`dealValue must be > 0 and ≤ ${String(COMMISSION_LIMITS.maxDealValue)}`);
  }
  assertFiniteNumber(commission.percent, 'percent');
  if (commission.percent < 0 || commission.percent > COMMISSION_LIMITS.maxCommissionPercent) {
    throw new RangeError(
      `percent must be between 0 and ${String(COMMISSION_LIMITS.maxCommissionPercent)}`,
    );
  }
  // ₹ × % = paise (₹ × % ÷ 100 × 100).
  return Math.round(dealValue * commission.percent);
}

/** Largest-remainder allocation of `total` paise by `weights` (percents summing to 100). */
function allocate(total: number, weights: number[]): number[] {
  const exact = weights.map((w) => (total * w) / 100);
  const floors = exact.map((x) => Math.floor(x + 1e-9));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, rem: x - (floors[i] ?? 0) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left--;
  }
  return floors;
}
