/**
 * Hand-built Razorpay-shaped fixtures for business day 2026-10-05 (IST), whose unix window is
 * [1791138600, 1791225000).
 *
 * Fees follow the standard rate quoted in docs/COSTS.md ("~2% + 18% GST on the fee"), computed
 * by hand, with Razorpay's documented convention that `fee` INCLUDES the GST and `tax` is the
 * GST alone (https://razorpay.com/docs/api/payments/ — payment entity: "fee: Fee (including
 * GST) charged by Razorpay", "tax: GST charged for the payment"; to be confirmed in test mode):
 *
 *   ₹199 → fee excl. GST 2% × 19900 = 398 p; GST 18% × 398 = 71.64 → 72 p; fee = 470 p; net 19430 p
 *   ₹299 → 598 p; 18% × 598 = 107.64 → 108 p; fee = 706 p; net 29194 p
 *   ₹399 → 798 p; 18% × 798 = 143.64 → 144 p; fee = 942 p; net 38958 p
 *   ₹500 → 1000 p; 180 p; fee = 1180 p; net 48820 p
 *
 * Several records carry buyer PII (email, contact, vpa, card, PII-bearing notes) on purpose:
 * the parser must drop all of it.
 */

import catalogFile from '../../../products/catalog.json' with { type: 'json' };
import { parseCatalog } from '../../../workers/lib/src/catalog.js';

export const catalog = parseCatalog(catalogFile);
export const DAY = '2026-10-05';
export const DAY_FROM = 1791138600;
export const DAY_TO = 1791225000;

export const PII = {
  email: 'buyer.name@example.com',
  contact: '+919876543210',
  name: 'Ramesh Kumar',
  vpa: 'ramesh@okbank',
};

export const rawPayments = [
  {
    id: 'pay_A1',
    entity: 'payment',
    amount: 19900,
    currency: 'INR',
    status: 'captured',
    order_id: null,
    method: 'upi',
    vpa: PII.vpa,
    email: PII.email,
    contact: PII.contact,
    fee: 470,
    tax: 72,
    notes: { product: 'lead-tracker', email: PII.email, phone: '9876543210', name: PII.name },
    created_at: 1791140000,
  },
  {
    id: 'pay_B2',
    entity: 'payment',
    amount: 29900,
    currency: 'INR',
    status: 'captured',
    order_id: 'order_B2',
    method: 'card',
    card: { last4: '1111', name: PII.name },
    email: PII.email,
    contact: PII.contact,
    fee: 706,
    tax: 108,
    notes: [],
    created_at: 1791200000,
  },
  {
    id: 'pay_C3',
    entity: 'payment',
    amount: 39900,
    currency: 'INR',
    status: 'refunded',
    order_id: null,
    email: PII.email,
    contact: PII.contact,
    fee: 942,
    tax: 144,
    notes: {},
    created_at: 1791210000,
  },
  {
    id: 'pay_D4',
    entity: 'payment',
    amount: 19900,
    currency: 'INR',
    status: 'failed',
    fee: null,
    tax: null,
    notes: [],
    created_at: 1791211000,
  },
  {
    id: 'pay_E5',
    entity: 'payment',
    amount: 50000,
    currency: 'INR',
    status: 'captured',
    fee: 1180,
    tax: 180,
    notes: [],
    created_at: 1791212000,
  },
];

export const rawRefunds = [
  {
    id: 'rfnd_R1',
    entity: 'refund',
    payment_id: 'pay_C3',
    amount: 39900,
    currency: 'INR',
    status: 'processed',
    notes: {
      reason_code: 'duplicate',
      approved_by: 'owner',
      comment: `buyer ${PII.email} asked twice`,
    },
    created_at: 1791220000,
  },
];

export const rawSettlements = [
  {
    id: 'setl_S1',
    entity: 'settlement',
    amount: 48236,
    status: 'processed',
    fees: 0,
    tax: 0,
    utr: 'UTR0000000001',
    created_at: 1791150000,
  },
];

/** A fake `fetch` that serves Razorpay list endpoints from arrays and records each call. */
export function fakeRazorpay(data: {
  payments?: unknown[];
  refunds?: unknown[];
  settlements?: unknown[];
  byId?: Record<string, unknown>;
}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (url: string, init: { method: 'GET'; headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    const u = new URL(url);
    const resource = u.pathname.replace(/^\/v1\//, '');
    const reply = (status: number, body: unknown) =>
      Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (resource.startsWith('payments/')) {
      const body = data.byId?.[resource.slice('payments/'.length)];
      return body
        ? reply(200, body)
        : reply(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'not found' } });
    }
    const all = (data as Record<string, unknown[] | undefined>)[resource] ?? [];
    const from = Number(u.searchParams.get('from'));
    const to = Number(u.searchParams.get('to'));
    const count = Number(u.searchParams.get('count'));
    const skip = Number(u.searchParams.get('skip'));
    const inRange = all.filter((x) => {
      const t = (x as { created_at: number }).created_at;
      return t >= from && t <= to;
    });
    return reply(200, {
      entity: 'collection',
      count: Math.min(count, inRange.length - skip),
      items: inRange.slice(skip, skip + count),
    });
  };
  return { fetch, calls };
}
