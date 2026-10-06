import { describe, expect, it } from 'vitest';
import {
  ORDER_COLUMNS,
  exportOrders,
  missingCloudflare,
  ordersQuery,
  parseWranglerJson,
  sanitizeOrderRows,
  sha256,
  wranglerConfig,
} from '../backup.mjs';

const order = (id: string, extra = {}) => ({
  payment_id: id,
  product_id: 'lead-tracker',
  amount_paise: 19900,
  email_hash: 'a'.repeat(64),
  event_id: 'evt_1',
  created_at: '2026-10-01T00:00:00Z',
  ...extra,
});
const wranglerOut = (rows: unknown[]) =>
  JSON.stringify([{ results: rows, success: true, meta: {} }]);

describe('ordersQuery', () => {
  it('selects only whitelisted columns with keyset pagination', () => {
    expect(ordersQuery(null, 1000)).toBe(
      'SELECT payment_id, product_id, amount_paise, email_hash, event_id, created_at FROM orders ORDER BY payment_id LIMIT 1000',
    );
    expect(ordersQuery("pay_1'x", 2)).toContain(
      "WHERE payment_id > 'pay_1''x' ORDER BY payment_id LIMIT 2",
    );
    expect(() => ordersQuery(null, 0)).toThrow(/pageSize/);
  });
});

describe('parseWranglerJson', () => {
  it('reads results arrays, also when log lines surround the JSON', () => {
    expect(parseWranglerJson(wranglerOut([order('pay_1')]))).toEqual([order('pay_1')]);
    expect(parseWranglerJson(`▲ warning\n${wranglerOut([order('pay_2')])}\ndone`)).toEqual([
      order('pay_2'),
    ]);
    expect(parseWranglerJson(JSON.stringify({ results: [], success: true }))).toEqual([]);
  });
  it('fails loudly on errors or unexpected output', () => {
    expect(() => parseWranglerJson('nothing here')).toThrow(/no JSON/);
    expect(() => parseWranglerJson(JSON.stringify([{ success: false, error: 'x' }]))).toThrow(
      /query failed/,
    );
    expect(() => parseWranglerJson(JSON.stringify([{ success: true }]))).toThrow(/results/);
  });
});

describe('sanitizeOrderRows', () => {
  it('drops unknown columns and fills missing ones with null', () => {
    const rows = sanitizeOrderRows([
      { ...order('pay_1'), name: 'Some Buyer', phone: '9999999999' },
      { payment_id: 'pay_2' },
    ]);
    expect(Object.keys(rows[0])).toEqual(ORDER_COLUMNS);
    expect(rows[0]).not.toHaveProperty('name');
    expect(rows[1]).toEqual({
      payment_id: 'pay_2',
      product_id: null,
      amount_paise: null,
      email_hash: null,
      event_id: null,
      created_at: null,
    });
  });
  it('refuses rows where an allowed column holds an email address', () => {
    expect(() => sanitizeOrderRows([order('pay_1', { email_hash: 'buyer@example.com' })])).toThrow(
      /row 0: column "email_hash" looks like an email/,
    );
  });
});

describe('exportOrders', () => {
  it('pages until a short page', async () => {
    const all = Array.from({ length: 5 }, (_, i) => order(`pay_${i}`));
    const queries: string[] = [];
    const rows = await exportOrders({
      database: 'toolshop-orders',
      pageSize: 2,
      runQuery: async (sql) => {
        queries.push(sql);
        const after = /payment_id > '([^']+)'/.exec(sql)?.[1];
        const start = after ? all.findIndex((o) => o.payment_id === after) + 1 : 0;
        return wranglerOut(all.slice(start, start + 2));
      },
    });
    expect(rows.map((r) => r.payment_id)).toEqual(all.map((o) => o.payment_id));
    expect(queries).toHaveLength(3);
  });
  it('never exports the waitlist database', async () => {
    await expect(
      exportOrders({ database: 'toolshop-waitlist', runQuery: async () => wranglerOut([]) }),
    ).rejects.toThrow(/personal data/);
  });
  it('stops if pagination does not advance', async () => {
    await expect(
      exportOrders({
        database: 'toolshop-orders',
        pageSize: 1,
        runQuery: async () => wranglerOut([order('pay_1')]),
      }),
    ).rejects.toThrow(/did not advance/);
    await expect(
      exportOrders({
        database: 'toolshop-orders',
        pageSize: 1,
        runQuery: async () => wranglerOut([{ payment_id: 7 }]),
      }),
    ).rejects.toThrow(/did not advance/);
  });
});

describe('helpers', () => {
  it('wranglerConfig points at toolshop-orders and validates the id', () => {
    const toml = wranglerConfig('12345678-1234-1234-1234-1234567890ab');
    expect(toml).toContain('database_name = "toolshop-orders"');
    expect(toml).toContain('database_id = "12345678-1234-1234-1234-1234567890ab"');
    expect(() => wranglerConfig('x"\n[evil]')).toThrow(/UUID/);
  });
  it('missingCloudflare lists absent settings', () => {
    expect(missingCloudflare({})).toEqual([
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'ORDERS_D1_ID',
    ]);
    expect(
      missingCloudflare({
        CLOUDFLARE_API_TOKEN: 'a',
        CLOUDFLARE_ACCOUNT_ID: 'b',
        ORDERS_D1_ID: 'c',
      }),
    ).toEqual([]);
  });
  it('sha256 is hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
