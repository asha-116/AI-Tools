import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findPii } from '../src/pii.js';
import {
  runController,
  type ControllerDeps,
  type GithubIssue,
  type GithubPullRequest,
} from '../src/run.js';
import { fakeRazorpay, rawPayments, rawRefunds, rawSettlements } from './fixtures.js';

const CATALOG = readFileSync(new URL('../../../products/catalog.json', import.meta.url), 'utf8');

function harness(opts: {
  now: string;
  files?: Record<string, string>;
  orders?: unknown;
  byId?: Record<string, unknown>;
  payments?: unknown[];
  refunds?: unknown[];
  settlements?: unknown[];
}) {
  const files = new Map<string, string>([
    ['products/catalog.json', CATALOG],
    ...Object.entries(opts.files ?? {}),
  ]);
  const issues: GithubIssue[] = [];
  const prs: GithubPullRequest[] = [];
  const logs: string[] = [];
  const rzp = fakeRazorpay({
    payments: opts.payments ?? rawPayments,
    refunds: opts.refunds ?? rawRefunds,
    settlements: opts.settlements ?? rawSettlements,
    byId: opts.byId ?? {},
  });
  const deps: ControllerDeps = {
    now: () => new Date(opts.now),
    fetch: rzp.fetch,
    env: {
      RAZORPAY_KEY_ID: 'rzp_test_k',
      RAZORPAY_KEY_SECRET: 'secret',
      ALLOW_DRAFT_PRODUCTS: 'true',
    },
    readFile: (p) => Promise.resolve(files.get(p) ?? null),
    writeFile: (p, c) => {
      files.set(p, c);
      return Promise.resolve();
    },
    readD1Orders: () => Promise.resolve(opts.orders ?? [{ results: [], success: true }]),
    github: {
      createIssue: (i) => {
        issues.push(i);
        return Promise.resolve();
      },
      openPullRequest: (pr) => {
        prs.push(pr);
        return Promise.resolve();
      },
    },
    log: (e, data) => logs.push(`${e} ${JSON.stringify(data)}`),
  };
  return { deps, files, issues, prs, logs, calls: rzp.calls };
}

const d1 = (rows: { payment_id: string; amount_paise: number; created_at: string }[]) => [
  {
    results: rows.map((r) => ({ product_id: null, email_hash: 'h', ...r })),
    success: true,
    meta: {},
  },
];

// Tuesday 2026-10-06 08:30 IST → business day 2026-10-05, not a weekly run.
const TUESDAY = '2026-10-06T03:00:00Z';

describe('runController — daily', () => {
  const orders = d1([
    { payment_id: 'pay_A1', amount_paise: 19900, created_at: '2026-10-04T18:40:00Z' },
    { payment_id: 'pay_B2', amount_paise: 29900, created_at: '2026-10-05T07:00:00Z' },
    { payment_id: 'pay_C3', amount_paise: 39900, created_at: '2026-10-05T08:00:00Z' },
    // Payment captured 23:50 IST the day before; the webhook row landed after midnight IST.
    { payment_id: 'pay_LATE', amount_paise: 19900, created_at: '2026-10-04T18:35:00Z' },
    { payment_id: 'pay_GONE', amount_paise: 19900, created_at: '2026-10-05T09:00:00Z' },
    { payment_id: 'pay_BADP', amount_paise: 19900, created_at: '2026-10-05T09:00:00Z' },
  ]);
  const byId = {
    pay_LATE: { ...rawPayments[0], id: 'pay_LATE', created_at: 1791138000 }, // 2026-10-04 23:50 IST
    pay_BADP: { ...rawPayments[0], id: 'pay_BADP', amount: -1 },
  };

  it('pulls the IST day, writes the ledger, reconciles, opens an Issue and a PR', async () => {
    const h = harness({ now: TUESDAY, orders, byId });
    const result = await runController(h.deps);

    expect(result.day).toBe('2026-10-05');
    expect(result.week).toBeNull();
    expect(result.added).toEqual({ sales: 5, refunds: 1, settlements: 1 });
    expect(h.calls[0]?.url).toContain('payments?from=1791138600&to=1791224999&count=100&skip=0');

    expect(h.files.get('company/ledger/sales.csv')).toBe(
      [
        'date,payment_id,order_id,product_slug,amount_inr,fee_inr,tax_on_fee_inr,status',
        '2026-10-04,pay_LATE,,lead-tracker,199.00,3.98,0.72,captured',
        '2026-10-05,pay_A1,,lead-tracker,199.00,3.98,0.72,captured',
        '2026-10-05,pay_B2,order_B2,commission-ledger,299.00,5.98,1.08,captured',
        '2026-10-05,pay_C3,,bundle,399.00,7.98,1.44,refunded',
        '2026-10-05,pay_E5,,unmatched,500.00,10.00,1.80,captured',
        '',
      ].join('\n'),
    );
    expect(h.files.get('company/ledger/refunds.csv')).toContain(
      '2026-10-05,rfnd_R1,pay_C3,399.00,duplicate,owner',
    );
    expect(h.files.get('company/ledger/settlements.csv')).toContain(
      '2026-10-05,setl_S1,482.36,yes',
    );
    expect(h.files.get('company/ledger/costs.csv')).toBe('date,service,amount_inr,note\n');

    expect(result.mismatches.map((m) => [m.type, m.ids.join()])).toEqual([
      ['invalid_record', 'pay_BADP'],
      ['payment_without_order', 'pay_E5'],
      ['order_without_payment', 'pay_GONE'],
    ]);
    expect(h.issues).toHaveLength(1);
    expect(h.issues[0]?.title).toBe('Controller: 3 reconciliation mismatch(es) for 2026-10-05');
    expect(h.issues[0]?.labels).toEqual(['type:bug', 'agent:controller']);
    expect(h.issues[0]?.body).toContain('| payment_without_order | pay_E5 | ₹500.00 |  |');

    expect(h.prs).toEqual([
      expect.objectContaining({
        branch: 'agent/controller/2026-10-05',
        title: 'chore: ledger for 2026-10-05',
        paths: [
          'company/ledger/sales.csv',
          'company/ledger/refunds.csv',
          'company/ledger/settlements.csv',
          'company/ledger/costs.csv',
        ],
      }),
    ]);
    expect(h.logs.at(-1)).toMatch(/^controller_done /);
  });

  it('never writes PII anywhere, although the API payloads contained it', async () => {
    const h = harness({ now: TUESDAY, orders, byId });
    await runController(h.deps);
    const outputs = [
      ...[...h.files.entries()].filter(([p]) => p !== 'products/catalog.json').map(([, c]) => c),
      ...h.issues.map((i) => i.body),
      ...h.prs.map((p) => p.body),
      ...h.logs,
    ];
    for (const text of outputs) {
      expect(text).not.toContain('@');
      expect(text).not.toMatch(/(?<!\d)[6-9]\d{9}(?!\d)/);
      expect(findPii(text)).toBeNull();
    }
  });

  it('is idempotent: a second run changes no file and opens no PR', async () => {
    const h = harness({ now: TUESDAY, orders, byId });
    await runController(h.deps);
    const snapshot = new Map(h.files);
    const again = await runController(h.deps);
    expect(again.added).toEqual({ sales: 0, refunds: 0, settlements: 0 });
    expect(again.written).toEqual([]);
    expect(h.files).toEqual(snapshot);
    expect(h.prs).toHaveLength(1);
  });

  it('a clean day opens no Issue', async () => {
    const h = harness({
      now: TUESDAY,
      payments: [rawPayments[0]],
      refunds: [],
      settlements: [],
      orders: d1([
        { payment_id: 'pay_A1', amount_paise: 19900, created_at: '2026-10-05T01:00:00Z' },
      ]),
    });
    const r = await runController(h.deps);
    expect(r.mismatches).toEqual([]);
    expect(h.issues).toEqual([]);
  });

  it('reports API records that fail validation', async () => {
    const h = harness({
      now: TUESDAY,
      payments: [{ ...rawPayments[0], fee: 'lots' }],
      refunds: [],
      settlements: [],
      orders: d1([]),
    });
    const r = await runController(h.deps);
    expect(r.mismatches).toEqual([
      { type: 'invalid_record', ids: ['pay_A1'], detail: 'razorpay payment: bad fee' },
    ]);
  });

  it('refuses to write a ledger file that contains PII and fails without a catalog', async () => {
    const h = harness({
      now: TUESDAY,
      files: {
        'company/ledger/costs.csv': 'date,service,amount_inr,note\n2026-10-01,x,1.00,ask a@b\n',
      },
    });
    await expect(runController(h.deps)).rejects.toThrow(/costs.csv: refusing to write/);

    const noCatalog = harness({ now: TUESDAY });
    noCatalog.files.delete('products/catalog.json');
    await expect(runController(noCatalog.deps)).rejects.toThrow(/catalog.json not found/);
  });
});

describe('runController — weekly (Mondays)', () => {
  // Monday 2026-10-12 08:30 IST → business day Sunday 2026-10-11 → P&L for 2026-W41.
  // Settlements are checked for the week before (W40, 28 Sep – 4 Oct) against settlements
  // dated 30 Sep – 6 Oct (lag 2 days).
  const MONDAY = '2026-10-12T03:00:00Z';
  const SALES = [
    'date,payment_id,order_id,product_slug,amount_inr,fee_inr,tax_on_fee_inr,status',
    '2026-10-01,pay_W40,,lead-tracker,199.00,3.98,0.72,captured',
    '2026-10-05,pay_A1,,lead-tracker,199.00,3.98,0.72,captured',
    '',
  ].join('\n');
  // 199.00 − 3.98 − 0.72 = 194.30
  const settlements = (amount: string) =>
    `date,settlement_id,amount_inr,utr_present\n2026-10-03,setl_W40,${amount},yes\n2026-10-07,setl_W41,194.30,yes\n`;

  it('writes the P&L for the finished ISO week and reconciles last week’s settlements', async () => {
    const h = harness({
      now: MONDAY,
      payments: [],
      refunds: [],
      settlements: [],
      orders: d1([]),
      files: {
        'company/ledger/sales.csv': SALES,
        'company/ledger/settlements.csv': settlements('194.30'),
        'company/reports/weekly/2026-W41.md': '# Week 2026-W41\n\nOrchestrator summary.\n',
      },
    });
    const r = await runController(h.deps);
    expect(r.day).toBe('2026-10-11');
    expect(r.week).toBe('2026-W41');
    expect(r.mismatches).toEqual([]);
    const report = h.files.get('company/reports/weekly/2026-W41.md') ?? '';
    expect(report).toMatch(
      /^# Week 2026-W41\n\nOrchestrator summary\.\n\n<!-- controller:pnl:start -->/,
    );
    expect(report).toContain('| Gross sales (1 payments) | ₹199.00 |');
    expect(report).toContain('| **Net of fees and refunds** | **₹194.30** |');
    expect(r.written).toEqual([
      'company/ledger/refunds.csv',
      'company/ledger/costs.csv',
      'company/reports/weekly/2026-W41.md',
    ]);
    expect(h.prs[0]?.title).toBe('chore: ledger for 2026-10-11 and P&L 2026-W41');
  });

  it('reports a settlement shortfall to the paisa', async () => {
    const h = harness({
      now: MONDAY,
      payments: [],
      refunds: [],
      settlements: [],
      orders: d1([]),
      files: {
        'company/ledger/sales.csv': SALES,
        'company/ledger/settlements.csv': settlements('194.29'),
      },
    });
    const r = await runController(h.deps);
    expect(r.mismatches).toEqual([
      expect.objectContaining({
        type: 'settlement_mismatch',
        ids: ['setl_W40'],
        expectedPaise: 19430,
        actualPaise: 19429,
      }),
    ]);
    expect(h.issues[0]?.body).toContain('| settlement_mismatch | setl_W40 | ₹194.30 | ₹194.29 |');
  });

  it('options override the clock-derived defaults', async () => {
    const h = harness({ now: MONDAY, payments: [], refunds: [], settlements: [], orders: d1([]) });
    const r = await runController(h.deps, {
      day: '2026-12-31',
      weekly: false,
      settlementLagDays: 3,
      feeIncludesTax: false,
    });
    expect(r.day).toBe('2026-12-31');
    expect(r.week).toBeNull();
  });
});
