import { describe, expect, it } from 'vitest';
import {
  createRazorpayClient,
  parsePayment,
  parseRefund,
  parseSettlement,
  pickNotes,
  RazorpayApiError,
  razorpayClientFromEnv,
  type FetchLike,
} from '../src/razorpay.js';
import {
  DAY_FROM,
  DAY_TO,
  fakeRazorpay,
  PII,
  rawPayments,
  rawRefunds,
  rawSettlements,
} from './fixtures.js';

const PII_KEYS = /"(email|contact|name|vpa|card|phone|bank|wallet)"/;

function client(fetch: FetchLike, pageSize = 100, maxPages?: number) {
  return createRazorpayClient({
    fetch,
    keyId: 'rzp_test_k',
    keySecret: 'secret',
    pageSize,
    ...(maxPages === undefined ? {} : { maxPages }),
  });
}

describe('parsers keep IDs and amounts, drop personal data', () => {
  it('parses a payment and drops email/contact/vpa/card and PII notes', () => {
    const r = parsePayment(rawPayments[0]);
    expect(r).toEqual({
      ok: true,
      value: {
        id: 'pay_A1',
        orderId: null,
        amountPaise: 19900,
        feePaise: 470,
        taxPaise: 72,
        status: 'captured',
        createdAt: 1791140000,
        notes: { product: 'lead-tracker' },
      },
    });
    for (const raw of rawPayments) {
      const json = JSON.stringify(parsePayment(raw));
      expect(json).not.toMatch(PII_KEYS);
      expect(json).not.toContain('@');
      expect(json).not.toContain('9876543210');
      expect(json).not.toContain(PII.name);
    }
  });

  it('parses refunds and keeps only slug-like reason/approver notes', () => {
    const r = parseRefund(rawRefunds[0]);
    expect(r).toEqual({
      ok: true,
      value: {
        id: 'rfnd_R1',
        paymentId: 'pay_C3',
        amountPaise: 39900,
        createdAt: 1791220000,
        notes: { reason_code: 'duplicate', approved_by: 'owner' },
      },
    });
    expect(JSON.stringify(r)).not.toContain('@');
  });

  it('pickNotes drops values that are not slugs (e.g. an email in an allowed key)', () => {
    expect(pickNotes({ approved_by: 'x@y.com', product: ' bundle ' })).toEqual({
      product: 'bundle',
    });
    expect(pickNotes([])).toEqual({});
    expect(pickNotes({ reason_code: 'has spaces in it' })).toEqual({});
  });

  it('parses settlements and keeps only whether a UTR exists', () => {
    expect(parseSettlement(rawSettlements[0])).toEqual({
      ok: true,
      value: { id: 'setl_S1', amountPaise: 48236, utrPresent: true, createdAt: 1791150000 },
    });
    const noUtr = parseSettlement({ ...rawSettlements[0], utr: null });
    expect(noUtr.ok && noUtr.value.utrPresent).toBe(false);
  });

  it.each([
    [{ ...rawPayments[0], id: 'order_X' }, 'bad id', null],
    [{ ...rawPayments[0], amount: 199.5 }, 'bad amount', 'pay_A1'],
    [{ ...rawPayments[0], amount: '19900' }, 'bad amount', 'pay_A1'],
    [{ ...rawPayments[0], currency: 'USD' }, 'currency is not INR', 'pay_A1'],
    [{ ...rawPayments[0], fee: -1 }, 'bad fee', 'pay_A1'],
    [{ ...rawPayments[0], tax: 1.5 }, 'bad tax', 'pay_A1'],
    [{ ...rawPayments[0], tax: 500 }, 'tax exceeds fee', 'pay_A1'],
    [{ ...rawPayments[0], fee: null, tax: 5 }, 'tax exceeds fee', 'pay_A1'],
    [{ ...rawPayments[0], status: 'weird' }, 'bad status', 'pay_A1'],
    [{ ...rawPayments[0], created_at: '2026-10-05' }, 'bad created_at', 'pay_A1'],
    [{ ...rawPayments[0], order_id: 'x' }, 'bad order_id', 'pay_A1'],
    ['nope', 'not an object', null],
  ])('rejects bad payment %#', (raw, reason, id) => {
    expect(parsePayment(raw)).toEqual({ ok: false, rejected: { kind: 'payment', id, reason } });
  });

  it.each([
    [{ ...rawRefunds[0], id: 'x' }, 'bad id'],
    [{ ...rawRefunds[0], payment_id: 'x' }, 'bad payment_id'],
    [{ ...rawRefunds[0], amount: 0 }, 'bad amount'],
    [{ ...rawRefunds[0], currency: 'EUR' }, 'currency is not INR'],
    [{ ...rawRefunds[0], created_at: 0 }, 'bad created_at'],
    [null, 'not an object'],
  ])('rejects bad refund %#', (raw, reason) => {
    const r = parseRefund(raw);
    expect(r.ok === false && r.rejected.reason).toBe(reason);
  });

  it.each([
    [{ ...rawSettlements[0], id: 'x' }, 'bad id'],
    [{ ...rawSettlements[0], amount: -5 }, 'bad amount'],
    [{ ...rawSettlements[0], created_at: null }, 'bad created_at'],
    [[], 'not an object'],
  ])('rejects bad settlement %#', (raw, reason) => {
    const r = parseSettlement(raw);
    expect(r.ok === false && r.rejected.reason).toBe(reason);
  });
});

describe('client', () => {
  it('uses Basic auth and paginates with from/to/count/skip', async () => {
    const { fetch, calls } = fakeRazorpay({ payments: rawPayments });
    const res = await client(fetch, 2).listPayments(DAY_FROM, DAY_TO);
    expect(res.items.map((p) => p.id)).toEqual(['pay_A1', 'pay_B2', 'pay_C3', 'pay_D4', 'pay_E5']);
    expect(res.rejected).toEqual([]);
    expect(calls.map((c) => c.url)).toEqual([
      `https://api.razorpay.com/v1/payments?from=${String(DAY_FROM)}&to=${String(DAY_TO - 1)}&count=2&skip=0`,
      `https://api.razorpay.com/v1/payments?from=${String(DAY_FROM)}&to=${String(DAY_TO - 1)}&count=2&skip=2`,
      `https://api.razorpay.com/v1/payments?from=${String(DAY_FROM)}&to=${String(DAY_TO - 1)}&count=2&skip=4`,
    ]);
    // base64("rzp_test_k:secret")
    expect(calls[0]?.headers['Authorization']).toBe('Basic cnpwX3Rlc3RfazpzZWNyZXQ=');
  });

  it('asks for one more page when the last page is exactly full', async () => {
    const { fetch, calls } = fakeRazorpay({
      refunds: [...rawRefunds, { ...rawRefunds[0], id: 'rfnd_R2' }],
    });
    const res = await client(fetch, 2).listRefunds(DAY_FROM, DAY_TO);
    expect(res.items).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it('reports invalid items, drops duplicates and anything outside the window', async () => {
    const fetch: FetchLike = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            items: [
              rawSettlements[0],
              rawSettlements[0],
              { ...rawSettlements[0], id: 'setl_OLD', created_at: DAY_FROM - 1 },
              { ...rawSettlements[0], id: 'setl_BAD', amount: 'x' },
            ],
          }),
      });
    const res = await client(fetch).listSettlements(DAY_FROM, DAY_TO);
    expect(res.items.map((s) => s.id)).toEqual(['setl_S1']);
    expect(res.rejected).toEqual([{ kind: 'settlement', id: 'setl_BAD', reason: 'bad amount' }]);
  });

  it('throws on API errors with the Razorpay error code only', async () => {
    const fetch: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { code: 'BAD_REQUEST_ERROR', description: 'auth' } }),
      });
    const err = await client(fetch)
      .listPayments(DAY_FROM, DAY_TO)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RazorpayApiError);
    expect((err as RazorpayApiError).message).toBe('Razorpay API error 401 (BAD_REQUEST_ERROR)');
  });

  it('copes with non-JSON error bodies', async () => {
    const fetch: FetchLike = () =>
      Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('html')) });
    await expect(client(fetch).listPayments(DAY_FROM, DAY_TO)).rejects.toThrow(
      'Razorpay API error 502',
    );
  });

  it('throws when the response has no items array or there are too many pages', async () => {
    const empty: FetchLike = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    await expect(client(empty).listPayments(DAY_FROM, DAY_TO)).rejects.toThrow(/no items array/);
    const { fetch } = fakeRazorpay({ payments: rawPayments });
    await expect(client(fetch, 1, 3).listPayments(DAY_FROM, DAY_TO)).rejects.toThrow(
      /more than 3 pages/,
    );
  });

  it('validates its arguments', async () => {
    const { fetch } = fakeRazorpay({});
    expect(() => client(fetch, 101)).toThrow(/pageSize/);
    expect(() => client(fetch, 0)).toThrow(/pageSize/);
    await expect(client(fetch).listPayments(DAY_TO, DAY_FROM)).rejects.toThrow(/from < to/);
    await expect(client(fetch).fetchPayment('../orders')).rejects.toThrow(/bad payment id/);
  });

  it('fetches one payment; 404 → null; other errors propagate', async () => {
    const { fetch } = fakeRazorpay({ byId: { pay_A1: rawPayments[0] } });
    const c = client(fetch);
    const p = await c.fetchPayment('pay_A1');
    expect(p?.ok && p.value.amountPaise).toBe(19900);
    expect(await c.fetchPayment('pay_ZZ')).toBeNull();
    const down: FetchLike = () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve(null) });
    await expect(client(down).fetchPayment('pay_A1')).rejects.toThrow('Razorpay API error 500');
  });

  it('reads credentials from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET', async () => {
    const { fetch, calls } = fakeRazorpay({ payments: [] });
    await razorpayClientFromEnv(
      { RAZORPAY_KEY_ID: 'rzp_test_k', RAZORPAY_KEY_SECRET: 'secret' },
      fetch,
    ).listPayments(DAY_FROM, DAY_TO);
    expect(calls[0]?.headers['Authorization']).toBe('Basic cnpwX3Rlc3RfazpzZWNyZXQ=');
    expect(() => razorpayClientFromEnv({ RAZORPAY_KEY_ID: 'k' }, fetch)).toThrow(
      /RAZORPAY_KEY_SECRET/,
    );
  });
});
