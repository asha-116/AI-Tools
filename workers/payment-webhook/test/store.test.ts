import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  d1Store,
  type D1Like,
  type D1PreparedStatementLike,
  type Order,
  type OrdersStore,
} from '../src/store.js';

/** Runs the real migration and SQL on SQLite (D1 is SQLite) through a D1-shaped adapter. */
function sqliteD1(db: DatabaseSync): D1Like {
  return {
    prepare(sql) {
      let params: unknown[] = [];
      const stmt: D1PreparedStatementLike = {
        bind(...values) {
          params = values;
          return stmt;
        },
        run() {
          const r = db.prepare(sql).run(...(params as never[]));
          return Promise.resolve({ meta: { changes: Number(r.changes) } });
        },
        first<T>() {
          const row = db.prepare(sql).get(...(params as never[]));
          return Promise.resolve((row ?? null) as T | null);
        },
      };
      return stmt;
    },
  };
}

const migration = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');

const order: Order = {
  paymentId: 'pay_A1',
  productId: 'lead-tracker',
  amountPaise: 19900,
  emailHash: 'h',
  eventId: 'evt_1',
  createdAt: '2026-10-05T10:00:00.000Z',
};

describe('d1Store (against SQLite)', () => {
  let db: DatabaseSync;
  let store: OrdersStore;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(migration);
    store = d1Store(sqliteD1(db));
  });

  it('records a payment once and reads it back', async () => {
    expect(await store.recordPayment(order)).toBe(true);
    expect(await store.recordPayment({ ...order, eventId: 'evt_2', productId: null })).toBe(false);
    expect(await store.findOrder('pay_A1')).toEqual(order);
    expect(await store.findOrder('pay_none')).toBeNull();
  });

  it('keeps unmatched payments and missing emails as NULL', async () => {
    await store.recordPayment({ ...order, productId: null, emailHash: null, eventId: null });
    expect(await store.findOrder('pay_A1')).toEqual({
      ...order,
      productId: null,
      emailHash: null,
      eventId: null,
    });
  });

  it('has no column that could hold a name, email address or phone number', () => {
    const cols = db
      .prepare("SELECT name FROM pragma_table_info('orders')")
      .all()
      .map((r) => String(r['name']));
    expect(cols).toEqual([
      'payment_id',
      'product_id',
      'amount_paise',
      'email_hash',
      'event_id',
      'created_at',
    ]);
  });

  it('counts and purges rate-limit windows', async () => {
    expect(await store.hitRateLimit('k', 100)).toBe(1);
    expect(await store.hitRateLimit('k', 100)).toBe(2);
    await store.hitRateLimit('new', 5000);
    await store.purgeRateLimits(1000);
    const keys = db
      .prepare('SELECT key FROM rate_limits')
      .all()
      .map((r) => r['key']);
    expect(keys).toEqual(['new']);
  });

  it('treats a missing result as "not inserted" and a missing count as 1', async () => {
    const empty: D1Like = {
      prepare: () => {
        const s: D1PreparedStatementLike = {
          bind: () => s,
          run: () => Promise.resolve({}),
          first: () => Promise.resolve(null),
        };
        return s;
      },
    };
    expect(await d1Store(empty).recordPayment(order)).toBe(false);
    expect(await d1Store(empty).hitRateLimit('k', 1)).toBe(1);
  });
});
