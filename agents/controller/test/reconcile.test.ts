import { describe, expect, it } from 'vitest';
import type { RefundRow, SaleRow, SettlementRow } from '../src/ledger.js';
import {
  parseD1Orders,
  reconcileOrders,
  reconcileSettlements,
  rejectedToMismatch,
  type D1Order,
} from '../src/reconcile.js';

const sale = (
  paymentId: string,
  amountPaise: number,
  feePaise: number,
  tax: number,
  date = '2026-10-05',
  status = 'captured',
): SaleRow => ({
  date,
  paymentId,
  orderId: '',
  productSlug: 'x',
  amountPaise,
  feePaise,
  taxOnFeePaise: tax,
  status,
});

// Same hand-computed fees as fixtures.ts (2% + 18% GST on the fee).
const SALES: SaleRow[] = [
  sale('pay_A1', 19900, 398, 72),
  sale('pay_B2', 29900, 598, 108),
  sale('pay_C3', 39900, 798, 144, '2026-10-05', 'refunded'),
  sale('pay_E5', 50000, 1000, 180),
  sale('pay_PREV', 19900, 398, 72, '2026-10-04'),
];

const order = (paymentId: string, amountPaise: number, createdAt: string): D1Order => ({
  paymentId,
  productId: 'lead-tracker',
  amountPaise,
  createdAt,
});

describe('parseD1Orders', () => {
  const rows = [
    {
      payment_id: 'pay_A1',
      product_id: 'lead-tracker',
      amount_paise: 19900,
      created_at: '2026-10-04T19:00:00.000Z',
      email_hash: 'abc',
    },
    {
      payment_id: 'pay_E5',
      product_id: null,
      amount_paise: 50000,
      created_at: '2026-10-05T10:00:00.000Z',
    },
  ];
  const expected = [
    {
      paymentId: 'pay_A1',
      productId: 'lead-tracker',
      amountPaise: 19900,
      createdAt: '2026-10-04T19:00:00.000Z',
    },
    {
      paymentId: 'pay_E5',
      productId: null,
      amountPaise: 50000,
      createdAt: '2026-10-05T10:00:00.000Z',
    },
  ];

  it('reads `wrangler d1 execute --json` output and drops extra columns like email_hash', () => {
    const out = parseD1Orders([{ results: rows, success: true, meta: { duration: 1 } }]);
    expect(out).toEqual({ orders: expected, invalid: [] });
    expect(JSON.stringify(out)).not.toContain('email_hash');
  });

  it('also accepts { results } and a bare row array', () => {
    expect(parseD1Orders({ results: rows }).orders).toEqual(expected);
    expect(parseD1Orders(rows).orders).toEqual(expected);
    expect(parseD1Orders([]).orders).toEqual([]);
  });

  it('reports invalid rows as invalid_record without echoing their content', () => {
    const out = parseD1Orders([
      {
        payment_id: 'pay_X1',
        product_id: 'a',
        amount_paise: '100',
        created_at: '2026-10-05T00:00:00Z',
      },
      { payment_id: 'buyer@example.com', amount_paise: 1, created_at: 'x' },
      { payment_id: 'pay_X2', product_id: 5, amount_paise: 1, created_at: '2026-10-05T00:00:00Z' },
      { payment_id: 'pay_X3', product_id: null, amount_paise: 1, created_at: 'yesterday' },
      'junk',
    ]);
    expect(out.orders).toEqual([]);
    expect(out.invalid.map((m) => m.ids)).toEqual([['pay_X1'], [], ['pay_X2'], ['pay_X3'], []]);
    expect(JSON.stringify(out)).not.toContain('@');
  });

  it('rejects something that is not wrangler output', () => {
    expect(() => parseD1Orders('nope')).toThrow(/wrangler/);
  });
});

describe('reconcileOrders', () => {
  it('returns nothing when every payment and order match', () => {
    const orders = SALES.filter((s) => s.date === '2026-10-05').map((s) =>
      order(s.paymentId, s.amountPaise, '2026-10-05T06:00:00Z'),
    );
    expect(
      reconcileOrders({ sales: SALES, orders, range: { from: '2026-10-05', to: '2026-10-05' } }),
    ).toEqual([]);
  });

  it('finds each mismatch type', () => {
    const orders = [
      // 00:30 IST on 5 Oct — inside the IST day although the UTC date is 4 Oct.
      order('pay_A1', 19900, '2026-10-04T19:00:00Z'),
      order('pay_B2', 29000, '2026-10-05T06:00:00Z'),
      order('pay_C3', 39900, '2026-10-05T06:00:00Z'),
      // pay_E5: no order
      order('pay_F6', 19900, '2026-10-05T07:00:00Z'),
      order('pay_D4', 19900, '2026-10-05T08:00:00Z'),
      // Payment captured 23:59 IST on 4 Oct, webhook row written on 5 Oct, wrong amount.
      order('pay_PREV', 29900, '2026-10-04T18:31:00Z'),
      // Outside the range: ignored.
      order('pay_OLD', 1, '2026-10-03T06:00:00Z'),
    ];
    const out = reconcileOrders({
      sales: SALES,
      otherPayments: new Map([['pay_D4', 'failed']]),
      orders,
      range: { from: '2026-10-05', to: '2026-10-05' },
    });
    expect(out).toEqual([
      {
        type: 'amount_mismatch',
        ids: ['pay_B2'],
        expectedPaise: 29900,
        actualPaise: 29000,
        detail: 'order amount differs from payment amount',
      },
      {
        type: 'payment_without_order',
        ids: ['pay_E5'],
        expectedPaise: 50000,
        detail: 'captured payment on 2026-10-05 has no order row',
      },
      {
        type: 'order_without_payment',
        ids: ['pay_F6'],
        actualPaise: 19900,
        detail: 'order on 2026-10-05 has no Razorpay payment',
      },
      {
        type: 'order_payment_not_captured',
        ids: ['pay_D4'],
        actualPaise: 19900,
        detail: 'order on 2026-10-05: payment status is "failed"',
      },
      {
        type: 'amount_mismatch',
        ids: ['pay_PREV'],
        expectedPaise: 19900,
        actualPaise: 29900,
        detail: 'order amount differs from payment amount',
      },
    ]);
  });

  it('reports an order whose ledger row has a non-captured status', () => {
    const out = reconcileOrders({
      sales: [sale('pay_Q1', 100, 0, 0, '2026-10-05', 'authorized')],
      orders: [order('pay_Q1', 100, '2026-10-05T06:00:00Z')],
      range: { from: '2026-10-05', to: '2026-10-05' },
    });
    expect(out.map((m) => m.type)).toEqual(['order_payment_not_captured']);
  });
});

describe('reconcileSettlements: settled = payments − fees − GST on fees − refunds', () => {
  const refunds: RefundRow[] = [
    {
      date: '2026-10-05',
      refundId: 'rfnd_R1',
      paymentId: 'pay_C3',
      amountPaise: 39900,
      reasonCode: '',
      approvedBy: '',
    },
    {
      date: '2026-10-20',
      refundId: 'rfnd_LATE',
      paymentId: 'pay_A1',
      amountPaise: 100,
      reasonCode: '',
      approvedBy: '',
    },
  ];
  const settle = (id: string, amountPaise: number, date: string): SettlementRow => ({
    date,
    settlementId: id,
    amountPaise,
    utrPresent: true,
  });
  const ranges = {
    paymentRange: { from: '2026-10-05', to: '2026-10-11' },
    settlementRange: { from: '2026-10-07', to: '2026-10-13' },
  };
  // Hand computation for payments 5–11 Oct (pay_PREV is 4 Oct, outside):
  //   gross  19900 + 29900 + 39900 + 50000         = 139700
  //   fees     398 +   598 +   798 +  1000         =   2794
  //   GST       72 +   108 +   144 +   180         =    504
  //   refunds 39900
  //   expected 139700 − 2794 − 504 − 39900         =  96502 paise = ₹965.02
  const expectedTotals = {
    grossPaise: 139700,
    feesPaise: 2794,
    taxOnFeesPaise: 504,
    refundsPaise: 39900,
    expectedPaise: 96502,
  };

  it('matches to the paisa', () => {
    const out = reconcileSettlements({
      sales: SALES,
      refunds,
      settlements: [
        settle('setl_S1', 50000, '2026-10-07'),
        settle('setl_S2', 46502, '2026-10-13'),
        settle('setl_X', 999, '2026-10-14'),
      ],
      ...ranges,
    });
    expect(out).toEqual({ ...expectedTotals, settledPaise: 96502, mismatch: null });
  });

  it('a 2-paise shortfall is a mismatch (tolerance 0)', () => {
    const out = reconcileSettlements({
      sales: SALES,
      refunds,
      settlements: [settle('setl_S1', 50000, '2026-10-07'), settle('setl_S2', 46500, '2026-10-08')],
      ...ranges,
    });
    expect(out.mismatch).toEqual({
      type: 'settlement_mismatch',
      ids: ['setl_S1', 'setl_S2'],
      expectedPaise: 96502,
      actualPaise: 96500,
      detail:
        'payments 2026-10-05..2026-10-11 vs settlements 2026-10-07..2026-10-13: difference -2 paise',
    });
  });
});

describe('rejectedToMismatch', () => {
  it('keeps only the ID and reason', () => {
    expect(rejectedToMismatch({ kind: 'payment', id: 'pay_A1', reason: 'bad fee' })).toEqual({
      type: 'invalid_record',
      ids: ['pay_A1'],
      detail: 'razorpay payment: bad fee',
    });
    expect(rejectedToMismatch({ kind: 'refund', id: null, reason: 'bad id' }).ids).toEqual([]);
  });
});
