import { computeEmi, EMI_LIMITS } from './emi.js';
import { assertFiniteNumber, assertNonNegative } from './numbers.js';

/**
 * Home loan balance transfer: what moving the outstanding loan to a lower rate saves.
 *
 *   current EMI          = EMI(outstanding, current rate, months left)
 *   new EMI              = EMI(outstanding, new rate, new tenure)   new tenure defaults to months left
 *   interest left        = current EMI × months left − outstanding
 *   new interest         = new EMI × new tenure − outstanding
 *   interest saved       = interest left − new interest
 *   net saving           = interest saved − switching costs (processing fee, legal, valuation…)
 *   break-even (months)  = ⌈switching costs ÷ (current EMI − new EMI)⌉, same tenure only
 *
 * Every rate and fee comes from the user; nothing is held as data. Before tax; ignores the
 * time value of money. Known answers: tools-core/test/fixtures/balance-transfer-known-answers.json.
 * All outputs are unrounded; round only for display.
 */
export interface BalanceTransferInput {
  /** Principal still owed today, ₹ (from the loan statement). */
  outstanding: number;
  currentRatePercent: number;
  /** Months of EMIs left on the current loan. */
  remainingMonths: number;
  newRatePercent: number;
  /** Tenure offered by the new lender (default: the same months left). */
  newTenureMonths?: number;
  /** One-time costs of switching, ₹ (default 0). */
  switchingCosts?: number;
}

export interface BalanceTransferResult {
  currentEmi: number;
  newEmi: number;
  /** Current EMI − new EMI (negative if the new EMI is higher). */
  emiDrop: number;
  currentInterestLeft: number;
  newInterest: number;
  /** Interest left − new interest (negative if the switch costs more interest). */
  interestSaved: number;
  /** Interest saved − switching costs. */
  netSaving: number;
  /** Months of lower EMIs that repay the switching costs; null if the tenure changes or the EMI does not drop. */
  breakEvenMonths: number | null;
}

export const BALANCE_TRANSFER_LIMITS = {
  maxAmount: EMI_LIMITS.maxPrincipal,
} as const;

function months(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > EMI_LIMITS.maxTenureMonths) {
    throw new RangeError(
      `${name} must be a whole number from 1 to ${String(EMI_LIMITS.maxTenureMonths)}`,
    );
  }
}

export function computeBalanceTransfer(input: BalanceTransferInput): BalanceTransferResult {
  const { outstanding, currentRatePercent, remainingMonths, newRatePercent } = input;
  const newTenureMonths = input.newTenureMonths ?? remainingMonths;
  const switchingCosts = input.switchingCosts ?? 0;
  assertFiniteNumber(outstanding, 'outstanding');
  if (outstanding <= 0 || outstanding > BALANCE_TRANSFER_LIMITS.maxAmount) {
    throw new RangeError(
      `outstanding must be > 0 and ≤ ${String(BALANCE_TRANSFER_LIMITS.maxAmount)}`,
    );
  }
  months(remainingMonths, 'remainingMonths');
  months(newTenureMonths, 'newTenureMonths');
  assertNonNegative(switchingCosts, 'switchingCosts');
  if (switchingCosts > BALANCE_TRANSFER_LIMITS.maxAmount) {
    throw new RangeError('switchingCosts is above the limit');
  }

  // computeEmi validates the rates (0–50%).
  const current = computeEmi({
    principal: outstanding,
    annualRatePercent: currentRatePercent,
    tenureMonths: remainingMonths,
  });
  const next = computeEmi({
    principal: outstanding,
    annualRatePercent: newRatePercent,
    tenureMonths: newTenureMonths,
  });
  const emiDrop = current.emi - next.emi;
  const interestSaved = current.totalInterest - next.totalInterest;
  let breakEvenMonths: number | null = null;
  if (switchingCosts === 0) breakEvenMonths = 0;
  else if (newTenureMonths === remainingMonths && emiDrop > 0) {
    breakEvenMonths = Math.ceil(switchingCosts / emiDrop);
  }
  return {
    currentEmi: current.emi,
    newEmi: next.emi,
    emiDrop,
    currentInterestLeft: current.totalInterest,
    newInterest: next.totalInterest,
    interestSaved,
    netSaving: interestSaved - switchingCosts,
    breakEvenMonths,
  };
}
