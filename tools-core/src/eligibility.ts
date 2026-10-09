import { EMI_LIMITS } from './emi.js';
import { assertFiniteNumber } from './numbers.js';

/**
 * Home-loan eligibility by FOIR (fixed obligations to income ratio).
 *
 *   maxTotalEmi  = monthly income × FOIR % ÷ 100
 *   availableEmi = max(0, maxTotalEmi − existing EMIs)
 *   maxLoan      = availableEmi × (1 − (1 + r)^−n) ÷ r,   r = annual % ÷ 12 ÷ 100
 *                  (= availableEmi × n when r = 0)
 *
 * maxLoan is the loan whose EMI (see emi.ts) equals availableEmi. The FOIR limit is the lender's
 * policy, not a rate we hold: the user enters it.
 * Known answers: tools-core/test/fixtures/eligibility-known-answers.json.
 * All outputs are unrounded; round only for display.
 */
export interface EligibilityInput {
  /** Net (take-home) monthly income of all applicants together, ₹. */
  monthlyIncome: number;
  /** EMIs already being paid each month, ₹. */
  existingEmis: number;
  /** The lender's limit on all EMIs as a percent of income, e.g. 50. */
  foirPercent: number;
  annualRatePercent: number;
  tenureMonths: number;
  /** Optional property price, ₹, to show the down payment still needed. */
  propertyPrice?: number;
}

export interface EligibilityResult {
  maxTotalEmi: number;
  availableEmi: number;
  maxLoan: number;
  /** Existing EMIs as a percent of income. */
  currentFoirPercent: number;
  /** propertyPrice − maxLoan, never below 0; only when a price was given. */
  downPayment?: number;
}

export const ELIGIBILITY_LIMITS = {
  maxAmount: 1_000_000_000, // ₹100 crore
  maxFoirPercent: 100,
} as const;

function checkAmount(value: number, name: string, min: number, minInclusive: boolean): void {
  assertFiniteNumber(value, name);
  const low = minInclusive ? value < min : value <= min;
  if (low || value > ELIGIBILITY_LIMITS.maxAmount) {
    throw new RangeError(
      `${name} must be ${minInclusive ? '≥' : '>'} ${String(min)} and ≤ ${String(ELIGIBILITY_LIMITS.maxAmount)}`,
    );
  }
}

export function computeEligibility(input: EligibilityInput): EligibilityResult {
  const { monthlyIncome, existingEmis, foirPercent, annualRatePercent, tenureMonths } = input;
  checkAmount(monthlyIncome, 'monthlyIncome', 0, false);
  checkAmount(existingEmis, 'existingEmis', 0, true);
  assertFiniteNumber(foirPercent, 'foirPercent');
  if (foirPercent <= 0 || foirPercent > ELIGIBILITY_LIMITS.maxFoirPercent) {
    throw new RangeError('foirPercent must be > 0 and ≤ 100');
  }
  assertFiniteNumber(annualRatePercent, 'annualRatePercent');
  if (annualRatePercent < 0 || annualRatePercent > EMI_LIMITS.maxAnnualRatePercent) {
    throw new RangeError(
      `annualRatePercent must be between 0 and ${String(EMI_LIMITS.maxAnnualRatePercent)}`,
    );
  }
  if (
    !Number.isInteger(tenureMonths) ||
    tenureMonths < 1 ||
    tenureMonths > EMI_LIMITS.maxTenureMonths
  ) {
    throw new RangeError(
      `tenureMonths must be a whole number from 1 to ${String(EMI_LIMITS.maxTenureMonths)}`,
    );
  }
  if (input.propertyPrice !== undefined) {
    checkAmount(input.propertyPrice, 'propertyPrice', 0, true);
  }

  const maxTotalEmi = (monthlyIncome * foirPercent) / 100;
  const availableEmi = Math.max(0, maxTotalEmi - existingEmis);
  const r = annualRatePercent / 1200;
  const maxLoan =
    r === 0 ? availableEmi * tenureMonths : (availableEmi * (1 - (1 + r) ** -tenureMonths)) / r;
  const result: EligibilityResult = {
    maxTotalEmi,
    availableEmi,
    maxLoan,
    currentFoirPercent: (existingEmis / monthlyIncome) * 100,
  };
  if (input.propertyPrice !== undefined) {
    result.downPayment = Math.max(0, input.propertyPrice - maxLoan);
  }
  return result;
}
