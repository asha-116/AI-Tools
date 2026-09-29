import { assertFiniteNumber } from './numbers.js';

/**
 * Equated Monthly Instalment on a reducing-balance loan with a fixed rate.
 *
 *   EMI = P × r × (1 + r)^n / ((1 + r)^n − 1),   r = annual % ÷ 12 ÷ 100
 *
 * Known answers: tools-core/test/fixtures/emi-known-answers.json.
 * All outputs are unrounded; round only for display.
 */
export interface EmiInput {
  /** Loan amount in ₹. */
  principal: number;
  /** Nominal annual interest rate in percent, e.g. 8.5 for 8.5% p.a. */
  annualRatePercent: number;
  /** Number of monthly instalments. */
  tenureMonths: number;
}

export interface EmiResult {
  emi: number;
  totalPayment: number;
  totalInterest: number;
  firstMonthInterest: number;
  firstMonthPrincipal: number;
}

export const EMI_LIMITS = {
  maxPrincipal: 1_000_000_000, // ₹100 crore
  maxAnnualRatePercent: 50,
  maxTenureMonths: 480, // 40 years
} as const;

export function computeEmi({ principal, annualRatePercent, tenureMonths }: EmiInput): EmiResult {
  assertFiniteNumber(principal, 'principal');
  if (principal <= 0 || principal > EMI_LIMITS.maxPrincipal) {
    throw new RangeError(`principal must be > 0 and ≤ ${String(EMI_LIMITS.maxPrincipal)}`);
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

  const r = annualRatePercent / 1200;
  const emi =
    r === 0
      ? principal / tenureMonths
      : (principal * r * (1 + r) ** tenureMonths) / ((1 + r) ** tenureMonths - 1);
  const totalPayment = emi * tenureMonths;
  const firstMonthInterest = principal * r;
  return {
    emi,
    totalPayment,
    totalInterest: totalPayment - principal,
    firstMonthInterest,
    firstMonthPrincipal: emi - firstMonthInterest,
  };
}
