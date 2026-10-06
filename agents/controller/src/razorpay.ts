/**
 * Read-only Razorpay REST client (GET only) for payments, refunds and settlements.
 *
 * Payload shapes are the commonly documented ones (Razorpay's docs could not be opened from the
 * build environment — see the Controller report / docs/PROGRESS.md for what the owner must
 * confirm against a test-mode account):
 *   GET /v1/payments?from&to&count&skip      → { entity: "collection", count, items: Payment[] }
 *   GET /v1/payments/:id                      → Payment
 *   GET /v1/refunds?from&to&count&skip       → { …, items: Refund[] }
 *   GET /v1/settlements?from&to&count&skip   → { …, items: Settlement[] }
 *
 * Personal data: Razorpay payments carry email, contact, vpa, card, bank and wallet details,
 * and Payment Page form fields can land in `notes`. The parsers below copy an explicit
 * allow-list of fields only, so none of that ever leaves this module.
 */

export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';
/** Razorpay's maximum page size for list endpoints. */
export const MAX_PAGE_SIZE = 100;

/** Only these note keys are kept; all other notes (possibly buyer form fields) are dropped. */
export const ALLOWED_NOTE_KEYS = ['product', 'reason_code', 'approved_by'] as const;
export type AllowedNotes = Partial<Record<(typeof ALLOWED_NOTE_KEYS)[number], string>>;

export const PAYMENT_STATUSES = [
  'created',
  'authorized',
  'captured',
  'refunded',
  'failed',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface RazorpayPayment {
  id: string;
  orderId: string | null;
  amountPaise: number;
  /** As reported by Razorpay. Assumed to INCLUDE the GST in `taxPaise` (see ledger.ts). */
  feePaise: number | null;
  taxPaise: number | null;
  status: PaymentStatus;
  createdAt: number;
  notes: AllowedNotes;
}

export interface RazorpayRefund {
  id: string;
  paymentId: string;
  amountPaise: number;
  createdAt: number;
  notes: AllowedNotes;
}

export interface RazorpaySettlement {
  id: string;
  amountPaise: number;
  utrPresent: boolean;
  createdAt: number;
}

export interface Rejected {
  kind: 'payment' | 'refund' | 'settlement';
  /** The record's ID when it had a well-formed one. */
  id: string | null;
  reason: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; rejected: Rejected };

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isNonNegInt = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const isPosInt = (x: unknown): x is number => isNonNegInt(x) && x > 0;

const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{1,40}$/;
const ORDER_ID_RE = /^order_[A-Za-z0-9]{1,40}$/;
const REFUND_ID_RE = /^rfnd_[A-Za-z0-9]{1,40}$/;
const SETTLEMENT_ID_RE = /^setl_[A-Za-z0-9]{1,40}$/;
/** Note values we keep are slugs / handles, never free text. */
const NOTE_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/;

/** Keeps allow-listed note keys whose values look like slugs. Razorpay sends `[]` for none. */
export function pickNotes(raw: unknown): AllowedNotes {
  const out: AllowedNotes = {};
  if (!isObj(raw)) return out;
  for (const key of ALLOWED_NOTE_KEYS) {
    const v = raw[key];
    if (typeof v === 'string' && NOTE_VALUE_RE.test(v.trim())) out[key] = v.trim();
  }
  return out;
}

function reject<T>(kind: Rejected['kind'], id: unknown, re: RegExp, reason: string): Parsed<T> {
  return {
    ok: false,
    rejected: { kind, id: typeof id === 'string' && re.test(id) ? id : null, reason },
  };
}

export function parsePayment(raw: unknown): Parsed<RazorpayPayment> {
  if (!isObj(raw)) return reject('payment', null, PAYMENT_ID_RE, 'not an object');
  const { id, order_id, amount, currency, fee, tax, status, created_at, notes } = raw;
  const bad = (reason: string) => reject<RazorpayPayment>('payment', id, PAYMENT_ID_RE, reason);
  if (typeof id !== 'string' || !PAYMENT_ID_RE.test(id)) return bad('bad id');
  if (!isPosInt(amount)) return bad('bad amount');
  if (currency !== undefined && currency !== 'INR') return bad('currency is not INR');
  if (fee != null && !isNonNegInt(fee)) return bad('bad fee');
  if (tax != null && !isNonNegInt(tax)) return bad('bad tax');
  if (isNonNegInt(tax) && tax > (isNonNegInt(fee) ? fee : 0)) return bad('tax exceeds fee');
  if (typeof status !== 'string' || !(PAYMENT_STATUSES as readonly string[]).includes(status)) {
    return bad('bad status');
  }
  if (!isPosInt(created_at)) return bad('bad created_at');
  if (order_id != null && (typeof order_id !== 'string' || !ORDER_ID_RE.test(order_id))) {
    return bad('bad order_id');
  }
  return {
    ok: true,
    value: {
      id,
      orderId: order_id ?? null,
      amountPaise: amount,
      feePaise: isNonNegInt(fee) ? fee : null,
      taxPaise: isNonNegInt(tax) ? tax : null,
      status: status as PaymentStatus,
      createdAt: created_at,
      notes: pickNotes(notes),
    },
  };
}

export function parseRefund(raw: unknown): Parsed<RazorpayRefund> {
  if (!isObj(raw)) return reject('refund', null, REFUND_ID_RE, 'not an object');
  const { id, payment_id, amount, currency, created_at, notes } = raw;
  const bad = (reason: string) => reject<RazorpayRefund>('refund', id, REFUND_ID_RE, reason);
  if (typeof id !== 'string' || !REFUND_ID_RE.test(id)) return bad('bad id');
  if (typeof payment_id !== 'string' || !PAYMENT_ID_RE.test(payment_id)) {
    return bad('bad payment_id');
  }
  if (!isPosInt(amount)) return bad('bad amount');
  if (currency !== undefined && currency !== 'INR') return bad('currency is not INR');
  if (!isPosInt(created_at)) return bad('bad created_at');
  return {
    ok: true,
    value: {
      id,
      paymentId: payment_id,
      amountPaise: amount,
      createdAt: created_at,
      notes: pickNotes(notes),
    },
  };
}

export function parseSettlement(raw: unknown): Parsed<RazorpaySettlement> {
  if (!isObj(raw)) return reject('settlement', null, SETTLEMENT_ID_RE, 'not an object');
  const { id, amount, utr, created_at } = raw;
  const bad = (reason: string) =>
    reject<RazorpaySettlement>('settlement', id, SETTLEMENT_ID_RE, reason);
  if (typeof id !== 'string' || !SETTLEMENT_ID_RE.test(id)) return bad('bad id');
  if (!isNonNegInt(amount)) return bad('bad amount');
  if (!isPosInt(created_at)) return bad('bad created_at');
  return {
    ok: true,
    value: {
      id,
      amountPaise: amount,
      utrPresent: typeof utr === 'string' && utr.trim().length > 0,
      createdAt: created_at,
    },
  };
}

export interface ListResult<T> {
  items: T[];
  rejected: Rejected[];
}

export class RazorpayApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Razorpay API error ${String(status)}${code ? ` (${code})` : ''}`);
    this.name = 'RazorpayApiError';
  }
}

export interface RazorpayClientOptions {
  fetch: FetchLike;
  keyId: string;
  keySecret: string;
  baseUrl?: string;
  /** 1–100; Razorpay's maximum is 100. */
  pageSize?: number;
  /** Safety stop: throws rather than silently truncating a huge range. */
  maxPages?: number;
}

export interface RazorpayClient {
  /** Items with created_at in [fromUnix, toUnix). */
  listPayments(fromUnix: number, toUnix: number): Promise<ListResult<RazorpayPayment>>;
  listRefunds(fromUnix: number, toUnix: number): Promise<ListResult<RazorpayRefund>>;
  listSettlements(fromUnix: number, toUnix: number): Promise<ListResult<RazorpaySettlement>>;
  /** One payment by ID; null if Razorpay says 404. */
  fetchPayment(id: string): Promise<Parsed<RazorpayPayment> | null>;
}

export const RAZORPAY_ENV = { keyId: 'RAZORPAY_KEY_ID', keySecret: 'RAZORPAY_KEY_SECRET' } as const;

/** Builds a client from env vars RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET. */
export function razorpayClientFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  fetch: FetchLike,
): RazorpayClient {
  const keyId = env[RAZORPAY_ENV.keyId];
  const keySecret = env[RAZORPAY_ENV.keySecret];
  if (!keyId || !keySecret) {
    throw new Error(`missing ${RAZORPAY_ENV.keyId} or ${RAZORPAY_ENV.keySecret}`);
  }
  return createRazorpayClient({ fetch, keyId, keySecret });
}

export function createRazorpayClient(opts: RazorpayClientOptions): RazorpayClient {
  const base = (opts.baseUrl ?? RAZORPAY_API_BASE).replace(/\/+$/, '');
  const pageSize = opts.pageSize ?? MAX_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`pageSize must be 1–${String(MAX_PAGE_SIZE)}`);
  }
  const maxPages = opts.maxPages ?? 1000;
  const headers = {
    Authorization: `Basic ${btoa(`${opts.keyId}:${opts.keySecret}`)}`,
    Accept: 'application/json',
  };

  async function get(path: string): Promise<unknown> {
    const res = await opts.fetch(`${base}${path}`, { method: 'GET', headers });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = isObj(body) && isObj(body['error']) ? body['error']['code'] : null;
      throw new RazorpayApiError(res.status, typeof err === 'string' ? err : null);
    }
    return body;
  }

  async function list<T extends { createdAt: number }>(
    resource: string,
    fromUnix: number,
    toUnix: number,
    parse: (raw: unknown) => Parsed<T>,
  ): Promise<ListResult<T>> {
    if (!Number.isSafeInteger(fromUnix) || !Number.isSafeInteger(toUnix) || toUnix <= fromUnix) {
      throw new Error('list: need integer unix seconds with from < to');
    }
    const out: ListResult<T> = { items: [], rejected: [] };
    const seen = new Set<string>();
    for (let page = 0; ; page += 1) {
      if (page >= maxPages) throw new Error(`${resource}: more than ${String(maxPages)} pages`);
      const q = new URLSearchParams({
        from: String(fromUnix),
        // Razorpay's `to` is inclusive; our windows are half-open.
        to: String(toUnix - 1),
        count: String(pageSize),
        skip: String(page * pageSize),
      });
      const body = await get(`/${resource}?${q.toString()}`);
      const items = isObj(body) ? body['items'] : undefined;
      if (!Array.isArray(items)) throw new Error(`${resource}: response has no items array`);
      for (const raw of items) {
        const r = parse(raw);
        if (!r.ok) {
          out.rejected.push(r.rejected);
          continue;
        }
        const v = r.value as T & { id: string };
        if (seen.has(v.id) || v.createdAt < fromUnix || v.createdAt >= toUnix) continue;
        seen.add(v.id);
        out.items.push(v);
      }
      if (items.length < pageSize) return out;
    }
  }

  return {
    listPayments: (f, t) => list('payments', f, t, parsePayment),
    listRefunds: (f, t) => list('refunds', f, t, parseRefund),
    listSettlements: (f, t) => list('settlements', f, t, parseSettlement),
    async fetchPayment(id) {
      if (!PAYMENT_ID_RE.test(id)) throw new Error('fetchPayment: bad payment id');
      try {
        return parsePayment(await get(`/payments/${id}`));
      } catch (e) {
        if (e instanceof RazorpayApiError && e.status === 404) return null;
        throw e;
      }
    },
  };
}
