import { computeEmi, EMI_LIMITS } from './emi.js';
import { assertFiniteNumber } from './numbers.js';

/**
 * Home-loan prepayment that keeps the EMI and shortens the tenure (the usual default in India).
 *
 * Month by month on a reducing balance, r = annual % ÷ 12 ÷ 100:
 *   interest   = balance × r
 *   balance    = balance − (EMI − interest)          (the last EMI pays only what is left)
 *   balance    = balance − prepayments made after that month's EMI
 *
 * A lump sum at month 0 is paid before the first EMI. Checked against the closed-form
 * remaining-balance and number-of-payments formulas, and against published examples:
 * tools-core/test/fixtures/prepayment-known-answers.json. Outputs are unrounded.
 */
export interface LumpSum {
  /** Paid right after this EMI number (0 = before the first EMI). */
  month: number;
  amount: number;
}

export interface PrepaymentInput {
  principal: number;
  annualRatePercent: number;
  tenureMonths: number;
  lumpSums?: LumpSum[];
  /** Extra paid with every EMI. */
  monthlyExtra?: number;
  /** Extra paid after every 12th EMI (e.g. one extra EMI a year). */
  yearlyExtra?: number;
}

export interface RepaymentSummary {
  /** Number of EMIs paid (the last one may be partial). */
  months: number;
  totalInterest: number;
  totalPrepaid: number;
  /** EMIs + prepayments. */
  totalPaid: number;
}

export interface PrepaymentResult {
  emi: number;
  baseline: RepaymentSummary;
  withPrepayment: RepaymentSummary;
  interestSaved: number;
  monthsSaved: number;
}

export const PREPAYMENT_LIMITS = {
  maxAmount: EMI_LIMITS.maxPrincipal,
  maxLumpSums: 24,
} as const;

/** A balance below half a paisa is treated as repaid (floating-point leftovers). */
const DONE = 0.005;

function checkAmount(value: number | undefined, name: string): number {
  if (value === undefined) return 0;
  assertFiniteNumber(value, name);
  if (value < 0 || value > PREPAYMENT_LIMITS.maxAmount) {
    throw new RangeError(`${name} must be between 0 and ${String(PREPAYMENT_LIMITS.maxAmount)}`);
  }
  return value;
}

function simulate(
  principal: number,
  r: number,
  emi: number,
  tenure: number,
  extraAfter: (month: number) => number,
): RepaymentSummary {
  let balance = principal;
  let totalInterest = 0;
  let totalPrepaid = 0;
  let paidEmis = 0;
  const prepay = (month: number) => {
    const x = Math.min(extraAfter(month), balance);
    balance -= x;
    totalPrepaid += x;
  };
  prepay(0);
  let months = 0;
  while (balance > DONE && months < tenure) {
    months++;
    const interest = balance * r;
    totalInterest += interest;
    const payment = Math.min(emi, balance + interest);
    paidEmis += payment;
    balance -= payment - interest;
    if (balance <= DONE) break;
    prepay(months);
  }
  return { months, totalInterest, totalPrepaid, totalPaid: paidEmis + totalPrepaid };
}

export function computePrepayment(input: PrepaymentInput): PrepaymentResult {
  const { principal, annualRatePercent, tenureMonths } = input;
  const { emi } = computeEmi({ principal, annualRatePercent, tenureMonths });
  const monthly = checkAmount(input.monthlyExtra, 'monthlyExtra');
  const yearly = checkAmount(input.yearlyExtra, 'yearlyExtra');
  const lumps = input.lumpSums ?? [];
  if (lumps.length > PREPAYMENT_LIMITS.maxLumpSums) {
    throw new RangeError(`at most ${String(PREPAYMENT_LIMITS.maxLumpSums)} lump sums`);
  }
  const byMonth = new Map<number, number>();
  for (const l of lumps) {
    if (!Number.isInteger(l.month) || l.month < 0 || l.month > tenureMonths) {
      throw new RangeError(
        `lump sum month must be a whole number from 0 to ${String(tenureMonths)}`,
      );
    }
    byMonth.set(l.month, (byMonth.get(l.month) ?? 0) + checkAmount(l.amount, 'lump sum'));
  }

  const r = annualRatePercent / 1200;
  const baseline = simulate(principal, r, emi, tenureMonths, () => 0);
  const withPrepayment = simulate(
    principal,
    r,
    emi,
    tenureMonths,
    (m) => (byMonth.get(m) ?? 0) + (m > 0 ? monthly : 0) + (m > 0 && m % 12 === 0 ? yearly : 0),
  );
  return {
    emi,
    baseline,
    withPrepayment,
    interestSaved: baseline.totalInterest - withPrepayment.totalInterest,
    monthsSaved: baseline.months - withPrepayment.months,
  };
}
