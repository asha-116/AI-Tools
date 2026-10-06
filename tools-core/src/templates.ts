import { COMMISSION_LIMITS } from './commission.js';
import { assertFiniteNumber, roundTo } from './numbers.js';

/**
 * Formula logic for the paid Google-Sheets templates, so the sheet formulas and the code agree.
 *
 * Specs (column formulas + hand-checked known answers):
 *   products/lead-tracker/spec.json        → followUpBucket, callList, leadSummary
 *   products/commission-ledger/spec.json   → ledgerDeal, ledgerTotals
 *
 * Dates are 'YYYY-MM-DD' strings (compared as text, which orders ISO dates correctly);
 * "today" is always passed in — nothing here reads the clock.
 * Money is computed in whole paise; ROUND(x, 2) in the sheet is half away from zero.
 */

// ---------------------------------------------------------------------------------------------
// Lead tracker
// ---------------------------------------------------------------------------------------------

/** Status option ids, in the order of the spec's `leads.status` options. */
export const LEAD_STATUSES = [
  'new',
  'contacted',
  'visit-planned',
  'visit-done',
  'negotiating',
  'won',
  'lost',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Source option ids, in the order of the spec's `leads.source` options. */
export const LEAD_SOURCES = [
  'walk-in',
  'call',
  'whatsapp',
  'portal',
  'referral',
  'social',
  'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export type FollowUpBucket = 'closed' | 'no-date' | 'overdue' | 'today' | 'upcoming';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertIsoDate(value: unknown, name: string): asserts value is string {
  const m = typeof value === 'string' ? ISO_DATE.exec(value) : null;
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return;
  }
  throw new RangeError(`${name} must be a real date as YYYY-MM-DD, got ${String(value)}`);
}

function assertStatus(status: unknown): asserts status is LeadStatus {
  if (!(LEAD_STATUSES as readonly unknown[]).includes(status)) {
    throw new RangeError(`unknown lead status ${String(status)}`);
  }
}

function isClosed(status: LeadStatus): boolean {
  return status === 'won' || status === 'lost';
}

function assertArray(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new RangeError(`${name} must be an array`);
}

/**
 * Follow-up column. Sheet:
 *   =IF(OR(status="Deal done",status="Lost"),"",IF(next="","No date",
 *     IF(next<TODAY(),"Overdue",IF(next=TODAY(),"Today","Upcoming"))))
 * An empty string for `nextDate` counts as no date, as a blank cell does.
 */
export function followUpBucket(
  status: LeadStatus,
  nextDate: string | null,
  today: string,
): FollowUpBucket {
  assertStatus(status);
  assertIsoDate(today, 'today');
  if (isClosed(status)) return 'closed';
  if (nextDate === null || nextDate === '') return 'no-date';
  assertIsoDate(nextDate, 'nextDate');
  if (nextDate < today) return 'overdue';
  if (nextDate === today) return 'today';
  return 'upcoming';
}

export interface CallListRow {
  name: string;
  status: LeadStatus;
  next: string | null;
}

/**
 * "Call today" sheet: names whose follow-up is overdue or today, oldest date first.
 * Ties keep the input (sheet row) order — Array.prototype.sort is stable, as is SORT().
 */
export function callList(rows: CallListRow[], today: string): string[] {
  assertArray(rows, 'rows');
  const due: Array<{ name: string; next: string }> = [];
  for (const row of rows) {
    if (typeof row.name !== 'string' || row.name.trim() === '') {
      throw new RangeError('every row needs a name');
    }
    const bucket = followUpBucket(row.status, row.next, today);
    // overdue/today imply a valid, non-empty date.
    if (bucket === 'overdue' || bucket === 'today')
      due.push({ name: row.name, next: String(row.next) });
  }
  return due.sort((a, b) => (a.next < b.next ? -1 : a.next > b.next ? 1 : 0)).map((r) => r.name);
}

export interface LeadSummaryRow {
  status: LeadStatus;
  /** A source option id; blank or missing is allowed (the column is optional). */
  source?: string | undefined;
}

export interface LeadSummary {
  total: number;
  /** Leads that are neither won nor lost (every other status counts as open). */
  open: number;
  won: number;
  lost: number;
  /** 100 × won ÷ (won + lost), 1 decimal; null when nothing is closed yet (sheet shows ""). */
  winRatePercent: number | null;
  /** Count per status id; statuses with no leads are left out. */
  byStatus: Partial<Record<LeadStatus, number>>;
  /** Count per source id; blank sources and sources with no leads are left out. */
  bySource: Partial<Record<LeadSource, number>>;
}

/** Summary sheet: COUNTIF by status and by source, and the win rate. */
export function leadSummary(rows: LeadSummaryRow[]): LeadSummary {
  assertArray(rows, 'rows');
  const byStatus: Partial<Record<LeadStatus, number>> = {};
  const bySource: Partial<Record<LeadSource, number>> = {};
  for (const { status, source } of rows) {
    assertStatus(status);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (source === undefined || source === '') continue;
    if (!(LEAD_SOURCES as readonly string[]).includes(source)) {
      throw new RangeError(`unknown lead source ${source}`);
    }
    const s = source as LeadSource;
    bySource[s] = (bySource[s] ?? 0) + 1;
  }
  const won = byStatus.won ?? 0;
  const lost = byStatus.lost ?? 0;
  const closed = won + lost;
  return {
    total: rows.length,
    open: rows.length - closed,
    won,
    lost,
    winRatePercent: closed === 0 ? null : roundTo((100 * won) / closed, 1),
    byStatus,
    bySource,
  };
}

// ---------------------------------------------------------------------------------------------
// Commission ledger
// ---------------------------------------------------------------------------------------------

export interface LedgerDealInput {
  /** Deal value in ₹; needed with commissionPercent. */
  dealValue?: number | undefined;
  /** Commission as % of the deal value. */
  commissionPercent?: number | undefined;
  /** Fixed commission in ₹; wins over the % when both are given (as in the sheet). */
  fixedCommission?: number | undefined;
  /** GST % charged on the commission, entered by the user; 0 when not charged. */
  gstPercent: number;
  /** Co-broker's share of the commission, in %. Default 0. */
  coBrokerPercent?: number | undefined;
  /** Amounts received for this deal, in ₹ (the Payments sheet rows). */
  payments: number[];
}

export type LedgerPaymentStatus = 'due' | 'part-paid' | 'paid';

export interface LedgerDealResult {
  commission: number;
  gst: number;
  invoiced: number;
  received: number;
  pending: number;
  status: LedgerPaymentStatus;
  coBrokerAmount: number;
  myShare: number;
}

export interface LedgerTotals {
  commission: number;
  invoiced: number;
  received: number;
  pending: number;
  myShare: number;
}

/** ₹ → whole paise, rounding half away from zero (sheet ROUND(x, 2)). */
function toPaise(rupees: number, name: string): number {
  assertFiniteNumber(rupees, name);
  return Math.round(roundTo(rupees, 2) * 100);
}

/**
 * Rounds a non-negative paise amount half up. The 6-decimal pre-round strips binary
 * artefacts (e.g. 1010 × 0.05 = 50.50000000000001) before the half-up decision.
 */
function roundPaise(paise: number): number {
  return roundTo(roundTo(paise, 6), 0);
}

function assertPercentInRange(value: unknown, name: string, max: number): asserts value is number {
  assertFiniteNumber(value as number, name);
  if ((value as number) < 0 || (value as number) > max) {
    throw new RangeError(`${name} must be between 0 and ${String(max)}`);
  }
}

function commissionPaise({ dealValue, commissionPercent, fixedCommission }: LedgerDealInput) {
  // Sheet: =IF(fixed<>"",ROUND(fixed,2),IF(AND(value<>"",pct<>""),ROUND(value*pct/100,2),""))
  if (fixedCommission !== undefined) {
    assertFiniteNumber(fixedCommission, 'fixedCommission');
    if (fixedCommission <= 0 || fixedCommission > COMMISSION_LIMITS.maxFixedAmount) {
      throw new RangeError(
        `fixedCommission must be > 0 and ≤ ${String(COMMISSION_LIMITS.maxFixedAmount)}`,
      );
    }
    return toPaise(fixedCommission, 'fixedCommission');
  }
  if (dealValue === undefined || commissionPercent === undefined) {
    throw new RangeError('give either fixedCommission, or both dealValue and commissionPercent');
  }
  assertFiniteNumber(dealValue, 'dealValue');
  if (dealValue <= 0 || dealValue > COMMISSION_LIMITS.maxDealValue) {
    throw new RangeError(`dealValue must be > 0 and ≤ ${String(COMMISSION_LIMITS.maxDealValue)}`);
  }
  assertPercentInRange(
    commissionPercent,
    'commissionPercent',
    COMMISSION_LIMITS.maxCommissionPercent,
  );
  // ₹ × % = paise (₹ × % ÷ 100 × 100).
  return roundPaise(dealValue * commissionPercent);
}

/** One row of the Deals sheet: every derived column for a deal. */
export function ledgerDeal(input: LedgerDealInput): LedgerDealResult {
  const commission = commissionPaise(input);

  assertPercentInRange(input.gstPercent, 'gstPercent', COMMISSION_LIMITS.maxGstPercent);
  const gst = roundPaise((commission * input.gstPercent) / 100);
  const invoiced = commission + gst;

  assertArray(input.payments, 'payments');
  let received = 0;
  for (const p of input.payments) {
    assertFiniteNumber(p as number, 'payment');
    if ((p as number) < 0) throw new RangeError('payment must be ≥ 0');
    received += toPaise(p as number, 'payment');
  }
  const pending = Math.max(0, invoiced - received);
  const status: LedgerPaymentStatus =
    received >= invoiced ? 'paid' : received > 0 ? 'part-paid' : 'due';

  const coPercent = input.coBrokerPercent ?? 0;
  assertPercentInRange(coPercent, 'coBrokerPercent', 100);
  const coBroker = roundPaise((commission * coPercent) / 100);

  return {
    commission: commission / 100,
    gst: gst / 100,
    invoiced: invoiced / 100,
    received: received / 100,
    pending: pending / 100,
    status,
    coBrokerAmount: coBroker / 100,
    myShare: (commission - coBroker) / 100,
  };
}

/** Summary sheet of the ledger: SUM of the money columns, to the paisa. */
export function ledgerTotals(deals: LedgerDealResult[]): LedgerTotals {
  assertArray(deals, 'deals');
  const keys = ['commission', 'invoiced', 'received', 'pending', 'myShare'] as const;
  const paise: Record<(typeof keys)[number], number> = {
    commission: 0,
    invoiced: 0,
    received: 0,
    pending: 0,
    myShare: 0,
  };
  for (const deal of deals) {
    for (const k of keys) paise[k] += toPaise(deal[k], k);
  }
  return {
    commission: paise.commission / 100,
    invoiced: paise.invoiced / 100,
    received: paise.received / 100,
    pending: paise.pending / 100,
    myShare: paise.myShare / 100,
  };
}
