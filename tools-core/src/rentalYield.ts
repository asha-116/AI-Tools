import { assertFiniteNumber } from './numbers.js';

/**
 * Rental yield on a property, before income tax.
 *
 *   investment       = property value + purchase costs (stamp duty, registration, interiors…)
 *   annualRent       = monthly rent × 12
 *   collectedRent    = monthly rent × (12 − empty months)
 *   netIncome        = collectedRent − yearly costs (maintenance, property tax, repairs…)
 *   grossYield %     = annualRent ÷ investment × 100
 *   netYield %       = netIncome ÷ investment × 100
 *   yearsOfRent      = investment ÷ annualRent   (price-to-rent ratio)
 *
 * Every amount comes from the user; nothing is held as data.
 * Known answers: tools-core/test/fixtures/rental-yield-known-answers.json.
 * All outputs are unrounded; round only for display.
 */
export interface RentalYieldInput {
  /** What the property costs or is worth, ₹. */
  propertyValue: number;
  monthlyRent: number;
  /** One-time costs paid on top of the value, ₹ (default 0). */
  purchaseCosts?: number;
  /** Costs the owner pays each year, ₹ (default 0). */
  yearlyCosts?: number;
  /** Months a year the property stands empty, 0–12 (default 0). */
  vacancyMonths?: number;
}

export interface RentalYieldResult {
  investment: number;
  annualRent: number;
  collectedRent: number;
  netIncome: number;
  grossYieldPercent: number;
  netYieldPercent: number;
  yearsOfRent: number;
}

export const RENTAL_YIELD_LIMITS = {
  maxAmount: 100_000_000_000, // ₹10,000 crore
} as const;

function check(value: number, name: string, positive: boolean): void {
  assertFiniteNumber(value, name);
  if ((positive ? value <= 0 : value < 0) || value > RENTAL_YIELD_LIMITS.maxAmount) {
    throw new RangeError(
      `${name} must be ${positive ? '> 0' : '≥ 0'} and ≤ ${String(RENTAL_YIELD_LIMITS.maxAmount)}`,
    );
  }
}

export function computeRentalYield(input: RentalYieldInput): RentalYieldResult {
  const { propertyValue, monthlyRent } = input;
  const purchaseCosts = input.purchaseCosts ?? 0;
  const yearlyCosts = input.yearlyCosts ?? 0;
  const vacancyMonths = input.vacancyMonths ?? 0;
  check(propertyValue, 'propertyValue', true);
  check(monthlyRent, 'monthlyRent', true);
  check(purchaseCosts, 'purchaseCosts', false);
  check(yearlyCosts, 'yearlyCosts', false);
  assertFiniteNumber(vacancyMonths, 'vacancyMonths');
  if (vacancyMonths < 0 || vacancyMonths > 12) {
    throw new RangeError('vacancyMonths must be from 0 to 12');
  }

  const investment = propertyValue + purchaseCosts;
  const annualRent = monthlyRent * 12;
  const collectedRent = monthlyRent * (12 - vacancyMonths);
  const netIncome = collectedRent - yearlyCosts;
  return {
    investment,
    annualRent,
    collectedRent,
    netIncome,
    grossYieldPercent: (annualRent / investment) * 100,
    netYieldPercent: (netIncome / investment) * 100,
    yearsOfRent: investment / annualRent,
  };
}
