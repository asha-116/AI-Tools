import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index.js';
import type { D1Like, D1PreparedStatementLike } from '../src/store.js';

function recordingDb(fail = false): D1Like & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    prepare(q) {
      sql.push(q);
      const s: D1PreparedStatementLike = {
        bind: () => s,
        run: () =>
          fail
            ? Promise.reject(new Error('db down: buyer@example.com'))
            : Promise.resolve({ meta: { changes: 1 } }),
        first: () => Promise.resolve(null),
      };
      return s;
    },
  };
}

function env(db: D1Like, over: Partial<Env> = {}): Env {
  return {
    DB: db,
    ALLOWED_ORIGINS: 'https://site.example',
    DOWNLOAD_BASE_URL: 'https://dl.example',
    RAZORPAY_WEBHOOK_SECRET: 'whsec',
    HASH_SECRET: 'h',
    DOWNLOAD_TOKEN_SECRET: 't',
    ...over,
  };
}

function signedWebhook(amount: number) {
  const raw = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_IDX1',
          amount,
          currency: 'INR',
          status: 'captured',
          email: 'buyer@example.com',
          notes: [],
        },
      },
    },
  });
  return new Request('https://w.example/api/razorpay/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': createHmac('sha256', 'whsec').update(raw).digest('hex'),
    },
    body: raw,
  });
}

describe('worker entry', () => {
  it('wires env and the real catalog into the handler and logs JSON lines', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const db = recordingDb();
    // ₹199 is a draft product in the real catalog: only sold when drafts are allowed.
    const res = await worker.fetch(signedWebhook(19900), env(db, { ALLOW_DRAFT_PRODUCTS: 'true' }));
    expect(res.status).toBe(200);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      evt: 'payment_recorded',
      payment_id: 'pay_IDX1',
      product: 'lead-tracker',
    });
    await worker.fetch(signedWebhook(19900), env(db));
    expect(JSON.parse(String(log.mock.calls[1]?.[0])).evt).toBe('payment_unmatched');
    log.mockRestore();
  });

  it('returns 500 (so Razorpay retries) without logging personal data when the database fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await worker.fetch(signedWebhook(19900), env(recordingDb(true)));
    expect(res.status).toBe(500);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('example.com');
    spy.mockRestore();
  });

  it('logs "unknown" for non-Error throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db: D1Like = {
      prepare: () => {
        throw 'boom';
      },
    };
    const res = await worker.fetch(signedWebhook(19900), env(db));
    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalledWith('payment_error', 'unknown');
    spy.mockRestore();
  });

  it('scheduled purges old rate-limit rows', async () => {
    const db = recordingDb();
    await worker.scheduled({}, env(db));
    expect(db.sql[0]).toContain('DELETE FROM rate_limits');
  });
});
