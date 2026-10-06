/**
 * Reconciliation (PROCEDURE step 3). Pure: works on ledger rows and the D1 orders export.
 * Tolerance is 0 paise. Mismatches carry IDs and amounts only — never personal data.
 */

import {
  CAPTURED_STATUSES,
  saleNetPaise,
  type RefundRow,
  type SaleRow,
  type SettlementRow,
} from './ledger.js';
import type { Rejected } from './razorpay.js';
import { istDateOfIso } from './time.js';

export type MismatchType =
  /** Captured payment with no row in the D1 `orders` table (webhook missed it). */
  | 'payment_without_order'
  /** D1 order whose payment Razorpay does not know. */
  | 'order_without_payment'
  /** D1 order whose payment exists but is not captured/refunded. */
  | 'order_payment_not_captured'
  /** Order amount ≠ payment amount. */
  | 'amount_mismatch'
  /** Settled total ≠ payments − fees − GST on fees − refunds for the window. */
  | 'settlement_mismatch'
  /** A Razorpay or D1 record failed validation and was skipped. */
  | 'invalid_record';

export interface Mismatch {
  type: MismatchType;
  /** Razorpay/D1 IDs involved (payment, refund, settlement IDs). */
  ids: string[];
  expectedPaise?: number;
  actualPaise?: number;
  detail: string;
}

/** One row of the D1 `orders` table, as exported (no email hash needed here). */
export interface D1Order {
  paymentId: string;
  productId: string | null;
  amountPaise: number;
  /** ISO-8601 instant. */
  createdAt: string;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Parses `wrangler d1 execute toolshop-orders --remote --json --command "SELECT payment_id,
 * product_id, amount_paise, created_at FROM orders"`. Wrangler prints an array of statement
 * results, each `{ results: Row[], success, meta }`. A bare `{ results }` or a plain row array
 * is accepted too. Extra columns (e.g. email_hash) are ignored and never copied.
 */
export function parseD1Orders(raw: unknown): { orders: D1Order[]; invalid: Mismatch[] } {
  let rows: unknown[];
  if (Array.isArray(raw) && raw.every((x) => isObj(x) && Array.isArray(x['results']))) {
    rows = raw.flatMap((x) => (x as { results: unknown[] }).results);
  } else if (isObj(raw) && Array.isArray(raw['results'])) {
    rows = raw['results'];
  } else if (Array.isArray(raw)) {
    rows = raw;
  } else {
    throw new Error('d1 export: expected wrangler --json output');
  }
  const orders: D1Order[] = [];
  const invalid: Mismatch[] = [];
  for (const r of rows) {
    const id = isObj(r) && typeof r['payment_id'] === 'string' ? r['payment_id'] : null;
    const amount = isObj(r) ? r['amount_paise'] : undefined;
    const product = isObj(r) ? r['product_id'] : undefined;
    const created = isObj(r) ? r['created_at'] : undefined;
    if (
      !id ||
      !/^pay_[A-Za-z0-9]{1,40}$/.test(id) ||
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      typeof created !== 'string' ||
      istDateOfIso(created) === null ||
      (product !== null && typeof product !== 'string')
    ) {
      invalid.push({
        type: 'invalid_record',
        ids: id && /^pay_[A-Za-z0-9]{1,40}$/.test(id) ? [id] : [],
        detail: 'd1 order row failed validation',
      });
      continue;
    }
    orders.push({
      paymentId: id,
      productId: product ?? null,
      amountPaise: amount,
      createdAt: created,
    });
  }
  return { orders, invalid };
}

export function rejectedToMismatch(r: Rejected): Mismatch {
  return {
    type: 'invalid_record',
    ids: r.id ? [r.id] : [],
    detail: `razorpay ${r.kind}: ${r.reason}`,
  };
}

/** Inclusive IST date range. */
export interface DateRange {
  from: string;
  to: string;
}

const inRange = (d: string, r: DateRange) => d >= r.from && d <= r.to;

export interface OrderReconInput {
  /**
   * Every known payment (whole ledger plus anything fetched this run). Captured ones dated in
   * `range` must have an order; any order dated in `range` is looked up here.
   */
  sales: readonly SaleRow[];
  /** Status of payments that exist at Razorpay but are not captured (so not in sales.csv). */
  otherPayments?: ReadonlyMap<string, string>;
  orders: readonly D1Order[];
  range: DateRange;
}

/** Every captured payment has an order; every order has a captured payment; amounts equal. */
export function reconcileOrders(input: OrderReconInput): Mismatch[] {
  const out: Mismatch[] = [];
  const orders = new Map(input.orders.map((o) => [o.paymentId, o]));
  const sales = new Map(input.sales.map((s) => [s.paymentId, s]));
  const amountChecked = new Set<string>();

  for (const s of input.sales) {
    if (!inRange(s.date, input.range) || !CAPTURED_STATUSES.has(s.status)) continue;
    const o = orders.get(s.paymentId);
    if (!o) {
      out.push({
        type: 'payment_without_order',
        ids: [s.paymentId],
        expectedPaise: s.amountPaise,
        detail: `captured payment on ${s.date} has no order row`,
      });
      continue;
    }
    amountChecked.add(s.paymentId);
    if (o.amountPaise !== s.amountPaise) out.push(amountMismatch(s, o));
  }

  for (const o of input.orders) {
    const d = istDateOfIso(o.createdAt);
    if (d === null || !inRange(d, input.range)) continue;
    const s = sales.get(o.paymentId);
    if (s && CAPTURED_STATUSES.has(s.status)) {
      if (!amountChecked.has(o.paymentId) && o.amountPaise !== s.amountPaise) {
        out.push(amountMismatch(s, o));
      }
      continue;
    }
    const other = input.otherPayments?.get(o.paymentId) ?? s?.status;
    out.push(
      other
        ? {
            type: 'order_payment_not_captured',
            ids: [o.paymentId],
            actualPaise: o.amountPaise,
            detail: `order on ${d}: payment status is "${other}"`,
          }
        : {
            type: 'order_without_payment',
            ids: [o.paymentId],
            actualPaise: o.amountPaise,
            detail: `order on ${d} has no Razorpay payment`,
          },
    );
  }
  return out;
}

function amountMismatch(s: SaleRow, o: D1Order): Mismatch {
  return {
    type: 'amount_mismatch',
    ids: [s.paymentId],
    expectedPaise: s.amountPaise,
    actualPaise: o.amountPaise,
    detail: 'order amount differs from payment amount',
  };
}

export interface SettlementReconInput {
  sales: readonly SaleRow[];
  refunds: readonly RefundRow[];
  settlements: readonly SettlementRow[];
  /** Payments and refunds dated in this range are expected to be settled… */
  paymentRange: DateRange;
  /** …by the settlements dated in this range. */
  settlementRange: DateRange;
}

export interface SettlementRecon {
  grossPaise: number;
  feesPaise: number;
  taxOnFeesPaise: number;
  refundsPaise: number;
  expectedPaise: number;
  settledPaise: number;
  mismatch: Mismatch | null;
}

/** settled = payments − fees − GST on fees − refunds, to the paisa. */
export function reconcileSettlements(input: SettlementReconInput): SettlementRecon {
  const sales = input.sales.filter(
    (s) => inRange(s.date, input.paymentRange) && CAPTURED_STATUSES.has(s.status),
  );
  const refunds = input.refunds.filter((r) => inRange(r.date, input.paymentRange));
  const settlements = input.settlements.filter((s) => inRange(s.date, input.settlementRange));
  const sum = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const grossPaise = sum(sales, (s) => s.amountPaise);
  const feesPaise = sum(sales, (s) => s.feePaise);
  const taxOnFeesPaise = sum(sales, (s) => s.taxOnFeePaise);
  const refundsPaise = sum(refunds, (r) => r.amountPaise);
  const expectedPaise = sum(sales, saleNetPaise) - refundsPaise;
  const settledPaise = sum(settlements, (s) => s.amountPaise);
  const mismatch: Mismatch | null =
    expectedPaise === settledPaise
      ? null
      : {
          type: 'settlement_mismatch',
          ids: settlements.map((s) => s.settlementId),
          expectedPaise,
          actualPaise: settledPaise,
          detail:
            `payments ${input.paymentRange.from}..${input.paymentRange.to} vs settlements ` +
            `${input.settlementRange.from}..${input.settlementRange.to}: difference ` +
            `${String(settledPaise - expectedPaise)} paise`,
        };
  return {
    grossPaise,
    feesPaise,
    taxOnFeesPaise,
    refundsPaise,
    expectedPaise,
    settledPaise,
    mismatch,
  };
}
