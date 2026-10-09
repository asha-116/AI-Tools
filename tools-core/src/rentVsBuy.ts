import { computeEmi, EMI_LIMITS } from './emi.js';
import { assertFiniteNumber } from './numbers.js';

/**
 * Rent vs buy over the same number of years, with the same money spent each month.
 *
 * Buyer: pays the down payment and purchase costs now, then the EMI (until the loan ends) and
 * the yearly owner costs. Renter: pays rent, rising by a fixed % once a year, and invests the
 * money the buyer paid up front. Each month, whichever side spends less invests the difference
 * at the same return. After `years`:
 *
 *   buyerWealth  = property value × (1 + appreciation)^years − loan left + buyer's investments
 *   renterWealth = renter's investments
 *   difference   = buyerWealth − renterWealth
 *
 * Returns compound monthly at (1 + yearly %)^(1/12) − 1, so a full year earns exactly the
 * yearly %. Before income tax; the user supplies every rate (nothing is held as data).
 * Known answers: tools-core/test/fixtures/rent-vs-buy-known-answers.json.
 */
export interface RentVsBuyInput {
  propertyValue: number;
  downPayment: number;
  /** Stamp duty, registration, brokerage, interiors… paid once by the buyer (default 0). */
  purchaseCosts?: number;
  annualRatePercent: number;
  tenureMonths: number;
  /** Maintenance, property tax, repairs per year (default 0). */
  ownerYearlyCosts?: number;
  /** Yearly change in the property's value, % (may be negative; default 0). */
  appreciationPercent?: number;
  monthlyRent: number;
  /** Yearly rent increase, % (default 0). */
  rentIncreasePercent?: number;
  /** Yearly return on money invested, % (default 0). */
  investReturnPercent?: number;
  /** Whole years to compare over. */
  years: number;
}

export interface RentVsBuyResult {
  emi: number;
  /** Down payment + purchase costs + EMIs + owner costs paid over the period. */
  buyerCashOut: number;
  rentPaid: number;
  propertyEnd: number;
  loanLeft: number;
  buyerWealth: number;
  renterWealth: number;
  difference: number;
}

export const RENT_VS_BUY_LIMITS = {
  maxAmount: 100_000_000_000, // ₹10,000 crore
  maxYears: 40,
  maxPercent: 50,
} as const;

function amount(value: number, name: string, positive: boolean): void {
  assertFiniteNumber(value, name);
  if ((positive ? value <= 0 : value < 0) || value > RENT_VS_BUY_LIMITS.maxAmount) {
    throw new RangeError(`${name} must be ${positive ? '> 0' : '≥ 0'} and ≤ the limit`);
  }
}

function percent(value: number, name: string, min: number): void {
  assertFiniteNumber(value, name);
  if (value < min || value > RENT_VS_BUY_LIMITS.maxPercent) {
    throw new RangeError(
      `${name} must be from ${String(min)} to ${String(RENT_VS_BUY_LIMITS.maxPercent)}`,
    );
  }
}

export function computeRentVsBuy(input: RentVsBuyInput): RentVsBuyResult {
  const { propertyValue, downPayment, annualRatePercent, tenureMonths, monthlyRent, years } = input;
  const purchaseCosts = input.purchaseCosts ?? 0;
  const ownerYearlyCosts = input.ownerYearlyCosts ?? 0;
  const appreciation = input.appreciationPercent ?? 0;
  const rentIncrease = input.rentIncreasePercent ?? 0;
  const investReturn = input.investReturnPercent ?? 0;

  amount(propertyValue, 'propertyValue', true);
  amount(downPayment, 'downPayment', false);
  if (downPayment > propertyValue)
    throw new RangeError('downPayment must not exceed propertyValue');
  amount(purchaseCosts, 'purchaseCosts', false);
  amount(ownerYearlyCosts, 'ownerYearlyCosts', false);
  amount(monthlyRent, 'monthlyRent', true);
  percent(annualRatePercent, 'annualRatePercent', 0); // same 50% cap as EMI_LIMITS
  if (
    !Number.isInteger(tenureMonths) ||
    tenureMonths < 1 ||
    tenureMonths > EMI_LIMITS.maxTenureMonths
  ) {
    throw new RangeError('tenureMonths must be a whole number from 1 to 480');
  }
  if (!Number.isInteger(years) || years < 1 || years > RENT_VS_BUY_LIMITS.maxYears) {
    throw new RangeError('years must be a whole number from 1 to 40');
  }
  percent(appreciation, 'appreciationPercent', -RENT_VS_BUY_LIMITS.maxPercent);
  percent(rentIncrease, 'rentIncreasePercent', 0);
  percent(investReturn, 'investReturnPercent', 0);

  const loan = propertyValue - downPayment;
  const emi = loan > 0 ? computeEmi({ principal: loan, annualRatePercent, tenureMonths }).emi : 0;
  const r = annualRatePercent / 1200;
  const growth = (1 + investReturn / 100) ** (1 / 12) - 1;
  const ownerMonthly = ownerYearlyCosts / 12;

  let balance = loan;
  let buyerCashOut = downPayment + purchaseCosts;
  let rentPaid = 0;
  let buyerInvested = 0;
  let renterInvested = downPayment + purchaseCosts;

  for (let m = 0; m < years * 12; m++) {
    const rent = monthlyRent * (1 + rentIncrease / 100) ** Math.floor(m / 12);
    let buyerOut = ownerMonthly;
    if (m < tenureMonths && balance > 0) {
      buyerOut += emi;
      balance = m === tenureMonths - 1 ? 0 : balance * (1 + r) - emi;
    }
    buyerCashOut += buyerOut;
    rentPaid += rent;
    buyerInvested *= 1 + growth;
    renterInvested *= 1 + growth;
    if (buyerOut > rent) renterInvested += buyerOut - rent;
    else buyerInvested += rent - buyerOut;
  }

  const loanLeft = Math.max(0, balance);
  const propertyEnd = propertyValue * (1 + appreciation / 100) ** years;
  const buyerWealth = propertyEnd - loanLeft + buyerInvested;
  return {
    emi,
    buyerCashOut,
    rentPaid,
    propertyEnd,
    loanLeft,
    buyerWealth,
    renterWealth: renterInvested,
    difference: buyerWealth - renterInvested,
  };
}
