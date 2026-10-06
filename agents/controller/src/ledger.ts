/**
 * company/ledger/*.csv — columns exactly as in agents/controller/PROCEDURE.md "Output schema".
 * Rows hold IDs, IST dates and amounts only. Amounts are integer paise in memory and rupees
 * with two decimals on disk.
 *
 * Merging is append-only and idempotent: a row whose key is already in the file is never
 * changed or duplicated (the first-seen row wins), and the file is kept sorted by date, then ID.
 */

import { resolveProduct, type Catalog } from '../../../workers/lib/src/catalog.js';
import { parseCsv, toCsv } from './csv.js';
import { paiseToRupees, rupeesToPaise } from './money.js';
import type {
  PaymentStatus,
  RazorpayPayment,
  RazorpayRefund,
  RazorpaySettlement,
} from './razorpay.js';
import { istDate, isValidDate } from './time.js';

/** Product slug written when a payment cannot be matched to exactly one catalog product. */
export const UNMATCHED_PRODUCT = 'unmatched';

/** Payment statuses that mean money was captured (a refunded payment was captured first). */
export const CAPTURED_STATUSES: ReadonlySet<string> = new Set(['captured', 'refunded']);

export interface SaleRow {
  date: string;
  paymentId: string;
  orderId: string;
  productSlug: string;
  amountPaise: number;
  /** Razorpay fee excluding GST. */
  feePaise: number;
  /** GST charged on the fee. */
  taxOnFeePaise: number;
  status: string;
}

export interface RefundRow {
  date: string;
  refundId: string;
  paymentId: string;
  amountPaise: number;
  reasonCode: string;
  approvedBy: string;
}

export interface SettlementRow {
  date: string;
  settlementId: string;
  amountPaise: number;
  utrPresent: boolean;
}

export interface CostRow {
  date: string;
  service: string;
  amountPaise: number;
  note: string;
}

export interface Table<R> {
  file: string;
  header: readonly string[];
  toFields(row: R): string[];
  fromFields(fields: readonly string[]): R;
  /** Identity for idempotency. */
  key(row: R): string;
  /** Secondary sort key after date. */
  id(row: R): string;
}

function field(fields: readonly string[], i: number): string {
  return fields[i] ?? '';
}

function date(s: string): string {
  if (!isValidDate(s)) throw new Error(`bad date: ${s}`);
  return s;
}

export const salesTable: Table<SaleRow> = {
  file: 'company/ledger/sales.csv',
  header: [
    'date',
    'payment_id',
    'order_id',
    'product_slug',
    'amount_inr',
    'fee_inr',
    'tax_on_fee_inr',
    'status',
  ],
  toFields: (r) => [
    r.date,
    r.paymentId,
    r.orderId,
    r.productSlug,
    paiseToRupees(r.amountPaise),
    paiseToRupees(r.feePaise),
    paiseToRupees(r.taxOnFeePaise),
    r.status,
  ],
  fromFields: (f) => ({
    date: date(field(f, 0)),
    paymentId: field(f, 1),
    orderId: field(f, 2),
    productSlug: field(f, 3),
    amountPaise: rupeesToPaise(field(f, 4)),
    feePaise: rupeesToPaise(field(f, 5)),
    taxOnFeePaise: rupeesToPaise(field(f, 6)),
    status: field(f, 7),
  }),
  key: (r) => r.paymentId,
  id: (r) => r.paymentId,
};

export const refundsTable: Table<RefundRow> = {
  file: 'company/ledger/refunds.csv',
  header: ['date', 'refund_id', 'payment_id', 'amount_inr', 'reason_code', 'approved_by'],
  toFields: (r) => [
    r.date,
    r.refundId,
    r.paymentId,
    paiseToRupees(r.amountPaise),
    r.reasonCode,
    r.approvedBy,
  ],
  fromFields: (f) => ({
    date: date(field(f, 0)),
    refundId: field(f, 1),
    paymentId: field(f, 2),
    amountPaise: rupeesToPaise(field(f, 3)),
    reasonCode: field(f, 4),
    approvedBy: field(f, 5),
  }),
  key: (r) => r.refundId,
  id: (r) => r.refundId,
};

export const settlementsTable: Table<SettlementRow> = {
  file: 'company/ledger/settlements.csv',
  header: ['date', 'settlement_id', 'amount_inr', 'utr_present'],
  toFields: (r) => [
    r.date,
    r.settlementId,
    paiseToRupees(r.amountPaise),
    r.utrPresent ? 'yes' : 'no',
  ],
  fromFields: (f) => {
    const utr = field(f, 3);
    if (utr !== 'yes' && utr !== 'no') throw new Error(`bad utr_present: ${utr}`);
    return {
      date: date(field(f, 0)),
      settlementId: field(f, 1),
      amountPaise: rupeesToPaise(field(f, 2)),
      utrPresent: utr === 'yes',
    };
  },
  key: (r) => r.settlementId,
  id: (r) => r.settlementId,
};

export const costsTable: Table<CostRow> = {
  file: 'company/ledger/costs.csv',
  header: ['date', 'service', 'amount_inr', 'note'],
  toFields: (r) => [r.date, r.service, paiseToRupees(r.amountPaise), r.note],
  fromFields: (f) => ({
    date: date(field(f, 0)),
    service: field(f, 1),
    amountPaise: rupeesToPaise(field(f, 2)),
    note: field(f, 3),
  }),
  // Costs have no external ID: the same service, day and note is the same cost line.
  key: (r) => `${r.date}|${r.service}|${r.note}`,
  id: (r) => `${r.service}|${r.note}`,
};

/** Reads a ledger CSV. Missing/empty file → no rows. A different header is an error. */
export function readTable<R>(table: Table<R>, text: string | null): R[] {
  if (text === null || text.trim() === '') return [];
  const [header, ...rows] = parseCsv(text);
  if (header?.join(',') !== table.header.join(',')) {
    throw new Error(`${table.file}: unexpected header "${header?.join(',') ?? ''}"`);
  }
  return rows.map((f, i) => {
    try {
      return table.fromFields(f);
    } catch (e) {
      throw new Error(`${table.file} line ${String(i + 2)}: ${(e as Error).message}`, { cause: e });
    }
  });
}

function sortRows<R extends { date: string }>(table: Table<R>, rows: R[]): R[] {
  return [...rows].sort((a, b) =>
    a.date === b.date
      ? table.id(a) < table.id(b)
        ? -1
        : table.id(a) > table.id(b)
          ? 1
          : 0
      : a.date < b.date
        ? -1
        : 1,
  );
}

export interface MergeResult<R> {
  rows: R[];
  csv: string;
  added: R[];
}

/** Append-only, idempotent merge of new rows into existing CSV text. */
export function mergeTable<R extends { date: string }>(
  table: Table<R>,
  existingText: string | null,
  incoming: readonly R[],
): MergeResult<R> {
  const rows = readTable(table, existingText);
  const keys = new Set(rows.map((r) => table.key(r)));
  const added: R[] = [];
  for (const r of incoming) {
    const k = table.key(r);
    if (keys.has(k)) continue;
    keys.add(k);
    added.push(r);
  }
  const sorted = sortRows(table, [...rows, ...added]);
  return {
    rows: sorted,
    csv: toCsv(
      table.header,
      sorted.map((r) => table.toFields(r)),
    ),
    added,
  };
}

export interface SaleOptions {
  /** Products with status "draft" count as sellable (Razorpay test mode / ALLOW_DRAFT_PRODUCTS). */
  allowDrafts: boolean;
  /**
   * Razorpay's payment `fee` is documented as including GST, with the GST alone in `tax`
   * (to be confirmed by the owner). true → fee_inr = fee − tax. false → fee_inr = fee.
   */
  feeIncludesTax: boolean;
}

/** sales.csv row for a captured (or later refunded) payment; null for any other status. */
export function saleFromPayment(
  p: RazorpayPayment,
  catalog: Catalog,
  opts: SaleOptions,
): SaleRow | null {
  if (!CAPTURED_STATUSES.has(p.status)) return null;
  const fee = p.feePaise ?? 0;
  const tax = p.taxPaise ?? 0;
  const product = resolveProduct(
    catalog,
    { amountPaise: p.amountPaise, notes: p.notes },
    opts.allowDrafts,
  );
  return {
    date: istDate(p.createdAt),
    paymentId: p.id,
    orderId: p.orderId ?? '',
    productSlug: product?.id ?? UNMATCHED_PRODUCT,
    amountPaise: p.amountPaise,
    feePaise: opts.feeIncludesTax ? fee - tax : fee,
    taxOnFeePaise: tax,
    status: p.status satisfies PaymentStatus,
  };
}

export function refundRow(r: RazorpayRefund): RefundRow {
  return {
    date: istDate(r.createdAt),
    refundId: r.id,
    paymentId: r.paymentId,
    amountPaise: r.amountPaise,
    reasonCode: r.notes.reason_code ?? '',
    approvedBy: r.notes.approved_by ?? '',
  };
}

export function settlementRow(s: RazorpaySettlement): SettlementRow {
  return {
    date: istDate(s.createdAt),
    settlementId: s.id,
    amountPaise: s.amountPaise,
    utrPresent: s.utrPresent,
  };
}

/** What a sale nets after Razorpay's fee and the GST on it. */
export function saleNetPaise(s: SaleRow): number {
  return s.amountPaise - s.feePaise - s.taxOnFeePaise;
}
