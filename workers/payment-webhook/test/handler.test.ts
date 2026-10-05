import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseCatalog } from '../../lib/src/catalog.js';
import { hmacHex } from '../../lib/src/crypto.js';
import { verifyDownloadToken } from '../../lib/src/token.js';
import {
  CLAIM_RATE_LIMIT,
  handleRequest,
  type HandlerConfig,
  type LogEntry,
} from '../src/handler.js';
import type { Order, OrdersStore } from '../src/store.js';

const ORIGIN = 'https://tools.changelense.in';
const WEBHOOK_SECRET = 'whsec_test';
const NOW = new Date('2026-10-05T10:00:00Z');
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const catalog = parseCatalog({
  products: [
    {
      id: 'lead-tracker',
      name_en: 'Lead tracker',
      name_hi: 'लीड ट्रैकर',
      price_inr: 199,
      status: 'live',
      files: [{ key: 'lt/v1/lt.xlsx', name: 'lt.xlsx', content_type: 'x' }],
    },
    {
      id: 'bundle',
      name_en: 'Bundle',
      name_hi: 'बंडल',
      price_inr: 399,
      status: 'draft',
      files: [
        { key: 'lt/v1/lt.xlsx', name: 'lt.xlsx', content_type: 'x' },
        { key: 'cl/v1/cl.xlsx', name: 'cl.xlsx', content_type: 'x' },
      ],
    },
  ],
});

function memoryStore() {
  const orders = new Map<string, Order>();
  const counts = new Map<string, number>();
  const store: OrdersStore = {
    recordPayment(o) {
      if (orders.has(o.paymentId)) return Promise.resolve(false);
      orders.set(o.paymentId, o);
      return Promise.resolve(true);
    },
    findOrder(id) {
      return Promise.resolve(orders.get(id) ?? null);
    },
    hitRateLimit(key) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return Promise.resolve(n);
    },
    purgeRateLimits() {
      return Promise.resolve();
    },
  };
  return { store, orders };
}

function setup(overrides: Partial<HandlerConfig> = {}) {
  const mem = memoryStore();
  const logs: LogEntry[] = [];
  const cfg: HandlerConfig = {
    store: mem.store,
    catalog,
    webhookSecret: WEBHOOK_SECRET,
    hashSecret: 'hash-secret',
    tokenSecret: 'token-secret',
    downloadBaseUrl: 'https://dl.example.workers.dev',
    allowedOrigins: `${ORIGIN}, http://localhost:4321`,
    allowDrafts: false,
    now: () => NOW,
    log: (e) => logs.push(e),
    ...overrides,
  };
  return { cfg, ...mem, logs };
}

function paymentEvent(
  over: { id?: string; amount?: number; email?: string; notes?: unknown; event?: string } = {},
) {
  return {
    entity: 'event',
    account_id: 'acc_TEST',
    event: over.event ?? 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: over.id ?? 'pay_TEST0001',
          entity: 'payment',
          amount: over.amount ?? 19900,
          currency: 'INR',
          status: 'captured',
          email: over.email ?? 'Buyer@Example.com',
          contact: '+919999999999',
          notes: over.notes ?? [],
        },
      },
    },
    created_at: NOW_SEC,
  };
}

function webhook(body: unknown, opts: { sig?: string | null; eventId?: string } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const sig =
    opts.sig === undefined
      ? createHmac('sha256', WEBHOOK_SECRET).update(raw, 'utf8').digest('hex')
      : opts.sig;
  if (sig !== null) headers.set('X-Razorpay-Signature', sig);
  if (opts.eventId) headers.set('X-Razorpay-Event-Id', opts.eventId);
  return new Request('https://pay.example.workers.dev/api/razorpay/webhook', {
    method: 'POST',
    headers,
    body: raw,
  });
}

function claim(body: unknown, init: { origin?: string | null; ip?: string } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
  headers.set('CF-Connecting-IP', init.ip ?? '203.0.113.9');
  return new Request('https://pay.example.workers.dev/api/claim', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('Razorpay webhook', () => {
  it('records a valid captured payment once, storing only a hash of the email', async () => {
    const { cfg, orders, logs } = setup();
    const res = await handleRequest(webhook(paymentEvent(), { eventId: 'evt_1' }), cfg);
    expect(res.status).toBe(200);
    const o = orders.get('pay_TEST0001');
    expect(o).toEqual({
      paymentId: 'pay_TEST0001',
      productId: 'lead-tracker',
      amountPaise: 19900,
      emailHash: await hmacHex('hash-secret', 'email|buyer@example.com'),
      eventId: 'evt_1',
      createdAt: NOW.toISOString(),
    });
    expect(JSON.stringify(o)).not.toMatch(/example\.com|9999/i);
    expect(logs).toEqual([
      { evt: 'payment_recorded', payment_id: 'pay_TEST0001', product: 'lead-tracker' },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/example\.com|9999/i);
  });

  it('is idempotent: a duplicate delivery (or order.paid after payment.captured) changes nothing', async () => {
    const { cfg, orders, logs } = setup();
    await handleRequest(webhook(paymentEvent(), { eventId: 'evt_1' }), cfg);
    const again = await handleRequest(webhook(paymentEvent(), { eventId: 'evt_1' }), cfg);
    const orderPaid = await handleRequest(
      webhook(paymentEvent({ event: 'order.paid' }), { eventId: 'evt_2' }),
      cfg,
    );
    expect(again.status).toBe(200);
    expect(orderPaid.status).toBe(200);
    expect(orders.size).toBe(1);
    expect(orders.get('pay_TEST0001')?.eventId).toBe('evt_1');
    expect(logs.map((l) => l.evt)).toEqual([
      'payment_recorded',
      'payment_duplicate',
      'payment_duplicate',
    ]);
  });

  it('rejects an invalid, missing or wrong-secret signature with 401 and stores nothing', async () => {
    for (const sig of [null, '', 'deadbeef', createHmac('sha256', 'x').update('y').digest('hex')]) {
      const { cfg, orders } = setup();
      const res = await handleRequest(webhook(paymentEvent(), { sig }), cfg);
      expect(res.status).toBe(401);
      expect(orders.size).toBe(0);
    }
  });

  it('rejects a body that was changed after signing', async () => {
    const { cfg, orders } = setup();
    const raw = JSON.stringify(paymentEvent());
    const sig = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    const tampered = raw.replace('19900', '39900');
    const res = await handleRequest(webhook(tampered, { sig }), cfg);
    expect(res.status).toBe(401);
    expect(orders.size).toBe(0);
  });

  it('acknowledges events it does not handle without storing them', async () => {
    const { cfg, orders } = setup();
    const res = await handleRequest(webhook(paymentEvent({ event: 'payment.failed' })), cfg);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(orders.size).toBe(0);
  });

  it('records but does not match a payment whose amount fits no product (needs support)', async () => {
    const { cfg, orders, logs } = setup();
    await handleRequest(webhook(paymentEvent({ amount: 12345 })), cfg);
    expect(orders.get('pay_TEST0001')?.productId).toBeNull();
    expect(logs[0]?.evt).toBe('payment_unmatched');
  });

  it('sells draft products only when drafts are allowed (Razorpay test mode)', async () => {
    const live = setup();
    await handleRequest(webhook(paymentEvent({ amount: 39900 })), live.cfg);
    expect(live.orders.get('pay_TEST0001')?.productId).toBeNull();
    const test = setup({ allowDrafts: true });
    await handleRequest(webhook(paymentEvent({ amount: 39900 })), test.cfg);
    expect(test.orders.get('pay_TEST0001')?.productId).toBe('bundle');
  });

  it('uses the "product" note when the Payment Page sends one', async () => {
    const { cfg, orders } = setup();
    await handleRequest(webhook(paymentEvent({ notes: { product: 'lead-tracker' } })), cfg);
    expect(orders.get('pay_TEST0001')?.productId).toBe('lead-tracker');
  });

  it('stores a null email hash when the payment has no email', async () => {
    const { cfg, orders } = setup();
    const ev = paymentEvent();
    delete (ev.payload.payment.entity as Partial<typeof ev.payload.payment.entity>).email;
    await handleRequest(webhook(ev), cfg);
    expect(orders.get('pay_TEST0001')?.emailHash).toBeNull();
  });

  it('rejects well-signed but malformed payloads with 400', async () => {
    const bad = [
      'not json',
      '[]',
      { event: 'payment.captured' },
      { event: 'payment.captured', payload: { payment: { entity: { id: 'x' } } } },
      paymentEvent({ id: 'order_123' }),
      {
        ...paymentEvent(),
        payload: {
          payment: { entity: { ...paymentEvent().payload.payment.entity, currency: 'USD' } },
        },
      },
      {
        ...paymentEvent(),
        payload: {
          payment: { entity: { ...paymentEvent().payload.payment.entity, status: 'authorized' } },
        },
      },
      {
        ...paymentEvent(),
        payload: { payment: { entity: { ...paymentEvent().payload.payment.entity, amount: 1.5 } } },
      },
    ];
    for (const body of bad) {
      const { cfg, orders } = setup();
      const res = await handleRequest(webhook(body), cfg);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(orders.size).toBe(0);
    }
  });

  it('rejects oversized bodies and non-POST methods', async () => {
    const { cfg } = setup();
    const big = JSON.stringify({ ...paymentEvent(), pad: 'x'.repeat(70_000) });
    expect((await handleRequest(webhook(big), cfg)).status).toBe(413);
    const get = new Request('https://pay.example.workers.dev/api/razorpay/webhook');
    expect((await handleRequest(get, cfg)).status).toBe(405);
  });

  it('fails closed when the webhook secret is not configured', async () => {
    const { cfg, orders } = setup({ webhookSecret: '' });
    expect((await handleRequest(webhook(paymentEvent()), cfg)).status).toBe(401);
    expect(orders.size).toBe(0);
  });
});

describe('claim endpoint', () => {
  async function paid(over: Parameters<typeof paymentEvent>[0] = {}, cfgOver = {}) {
    const s = setup(cfgOver);
    await handleRequest(webhook(paymentEvent(over)), s.cfg);
    return s;
  }

  it('returns a 72-hour link per file when payment id and email match', async () => {
    const { cfg } = await paid({ amount: 39900 }, { allowDrafts: true });
    const res = await handleRequest(
      claim({ payment_id: ' pay_TEST0001 ', email: ' buyer@EXAMPLE.com' }),
      cfg,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as {
      ok: boolean;
      product: string;
      expires_at: string;
      links: { file: string; url: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.product).toBe('bundle');
    expect(body.expires_at).toBe(new Date((NOW_SEC + 72 * 3600) * 1000).toISOString());
    expect(body.links.map((l) => l.file)).toEqual(['lt.xlsx', 'cl.xlsx']);
    for (const [i, l] of body.links.entries()) {
      expect(l.url.startsWith('https://dl.example.workers.dev/d/')).toBe(true);
      const token = l.url.slice('https://dl.example.workers.dev/d/'.length);
      const v = await verifyDownloadToken(token, 'token-secret', NOW_SEC);
      expect(v).toEqual({
        ok: true,
        claims: {
          paymentId: 'pay_TEST0001',
          productId: 'bundle',
          fileKey: i === 0 ? 'lt/v1/lt.xlsx' : 'cl/v1/cl.xlsx',
          expiresAt: NOW_SEC + 72 * 3600,
        },
      });
    }
  });

  it('gives the same "not found" for an unknown payment and for a wrong email', async () => {
    const { cfg } = await paid();
    const unknown = await handleRequest(
      claim({ payment_id: 'pay_NOPE', email: 'buyer@example.com' }),
      cfg,
    );
    const wrong = await handleRequest(
      claim({ payment_id: 'pay_TEST0001', email: 'someone@else.com' }),
      cfg,
    );
    expect(unknown.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it('cannot claim a payment that arrived without an email', async () => {
    const s = setup();
    const ev = paymentEvent();
    delete (ev.payload.payment.entity as Partial<typeof ev.payload.payment.entity>).email;
    await handleRequest(webhook(ev), s.cfg);
    const res = await handleRequest(claim({ payment_id: 'pay_TEST0001', email: 'a@b.co' }), s.cfg);
    expect(res.status).toBe(404);
  });

  it('asks the buyer to contact support when the payment matched no product', async () => {
    const { cfg } = await paid({ amount: 12345 });
    const res = await handleRequest(
      claim({ payment_id: 'pay_TEST0001', email: 'buyer@example.com' }),
      cfg,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'needs_support' });
  });

  it('rate-limits claims per IP per hour', async () => {
    const { cfg } = await paid();
    for (let i = 0; i < CLAIM_RATE_LIMIT; i++) {
      await handleRequest(claim({ payment_id: 'pay_X', email: 'a@b.co' }), cfg);
    }
    const res = await handleRequest(
      claim({ payment_id: 'pay_TEST0001', email: 'buyer@example.com' }),
      cfg,
    );
    expect(res.status).toBe(429);
    const other = await handleRequest(
      claim({ payment_id: 'pay_TEST0001', email: 'buyer@example.com' }, { ip: '198.51.100.1' }),
      cfg,
    );
    expect(other.status).toBe(200);
  });

  it('enforces the origin allow-list and answers CORS preflight', async () => {
    const { cfg } = await paid();
    const foreign = await handleRequest(
      claim(
        { payment_id: 'pay_TEST0001', email: 'buyer@example.com' },
        { origin: 'https://evil.example' },
      ),
      cfg,
    );
    expect(foreign.status).toBe(403);
    const none = await handleRequest(
      claim({ payment_id: 'pay_TEST0001', email: 'buyer@example.com' }, { origin: null }),
      cfg,
    );
    expect(none.status).toBe(403);
    const pre = await handleRequest(
      new Request('https://pay.example.workers.dev/api/claim', {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN },
      }),
      cfg,
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    const preBad = await handleRequest(
      new Request('https://pay.example.workers.dev/api/claim', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      }),
      cfg,
    );
    expect(preBad.status).toBe(403);
  });

  it('validates the request body', async () => {
    const { cfg } = await paid();
    const cases: [unknown, number][] = [
      ['nope', 400],
      [[], 400],
      [{ payment_id: 'pay_TEST0001' }, 400],
      [{ payment_id: 'order_1', email: 'buyer@example.com' }, 400],
      [{ payment_id: 'pay_TEST0001', email: 'not-an-email' }, 400],
      [{ payment_id: 'pay_' + 'x'.repeat(60), email: 'buyer@example.com' }, 400],
    ];
    for (const [body, status] of cases) {
      const res = await handleRequest(claim(body, { ip: `10.0.0.${String(status)}` }), cfg);
      expect(res.status, JSON.stringify(body)).toBe(status);
    }
    const wrongType = new Request('https://pay.example.workers.dev/api/claim', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect((await handleRequest(wrongType, cfg)).status).toBe(415);
    const big = await handleRequest(claim({ pad: 'x'.repeat(3000) }), cfg);
    expect(big.status).toBe(413);
    const get = new Request('https://pay.example.workers.dev/api/claim', {
      headers: { Origin: ORIGIN },
    });
    expect((await handleRequest(get, cfg)).status).toBe(405);
  });
});

describe('routing', () => {
  it('returns 404 for unknown paths', async () => {
    const { cfg } = setup();
    expect((await handleRequest(new Request('https://pay.example.workers.dev/'), cfg)).status).toBe(
      404,
    );
  });
});
