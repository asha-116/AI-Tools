import { describe, expect, it } from 'vitest';
import {
  costsTable,
  mergeTable,
  readTable,
  refundRow,
  refundsTable,
  saleFromPayment,
  saleNetPaise,
  salesTable,
  settlementRow,
  settlementsTable,
  type SaleRow,
} from '../src/ledger.js';
import { findPii } from '../src/pii.js';
import {
  parsePayment,
  parseRefund,
  parseSettlement,
  type RazorpayPayment,
} from '../src/razorpay.js';
import { catalog, rawPayments, rawRefunds, rawSettlements } from './fixtures.js';

const opts = { allowDrafts: true, feeIncludesTax: true };

function payments(): RazorpayPayment[] {
  return rawPayments.map((r) => {
    const p = parsePayment(r);
    if (!p.ok) throw new Error('fixture');
    return p.value;
  });
}

function sales(): SaleRow[] {
  return payments()
    .map((p) => saleFromPayment(p, catalog, opts))
    .filter((s): s is SaleRow => s !== null);
}

const SALES_CSV = [
  'date,payment_id,order_id,product_slug,amount_inr,fee_inr,tax_on_fee_inr,status',
  '2026-10-05,pay_A1,,lead-tracker,199.00,3.98,0.72,captured',
  '2026-10-05,pay_B2,order_B2,commission-ledger,299.00,5.98,1.08,captured',
  '2026-10-05,pay_C3,,bundle,399.00,7.98,1.44,refunded',
  '2026-10-05,pay_E5,,unmatched,500.00,10.00,1.80,captured',
  '',
].join('\n');

describe('sales rows', () => {
  it('splits Razorpay fee (incl. GST) into fee excl. GST and GST — hand-computed', () => {
    const [a1, b2, c3, e5] = sales();
    expect(a1).toEqual({
      date: '2026-10-05',
      paymentId: 'pay_A1',
      orderId: '',
      productSlug: 'lead-tracker',
      amountPaise: 19900,
      feePaise: 398,
      taxOnFeePaise: 72,
      status: 'captured',
    });
    expect([a1, b2, c3, e5].map((s) => s && saleNetPaise(s))).toEqual([19430, 29194, 38958, 48820]);
  });

  it('can treat fee as excluding GST if the owner finds that is how Razorpay reports it', () => {
    const p = payments()[0] as RazorpayPayment;
    const s = saleFromPayment(p, catalog, { ...opts, feeIncludesTax: false });
    expect(s?.feePaise).toBe(470);
    expect(s && saleNetPaise(s)).toBe(19900 - 470 - 72);
  });

  it('resolves products like the payment webhook: notes.product, else unique price; drafts only when allowed', () => {
    const [a1, b2, c3, e5] = sales();
    expect([a1, b2, c3, e5].map((s) => s?.productSlug)).toEqual([
      'lead-tracker',
      'commission-ledger',
      'bundle',
      'unmatched',
    ]);
    const live = saleFromPayment(payments()[1] as RazorpayPayment, catalog, {
      ...opts,
      allowDrafts: false,
    });
    expect(live?.productSlug).toBe('unmatched');
  });

  it('skips payments that were never captured', () => {
    expect(saleFromPayment(payments()[3] as RazorpayPayment, catalog, opts)).toBeNull();
  });

  it('writes exactly the PROCEDURE.md columns, sorted by date then ID', () => {
    const shuffled = [...sales()].reverse();
    expect(mergeTable(salesTable, null, shuffled).csv).toBe(SALES_CSV);
  });

  it('treats a missing fee as zero', () => {
    const p = { ...(payments()[0] as RazorpayPayment), feePaise: null, taxPaise: null };
    expect(saleFromPayment(p, catalog, opts)?.feePaise).toBe(0);
  });
});

describe('CSV round trip and idempotent merge', () => {
  it('reads back exactly what it wrote (integer paise both ways)', () => {
    expect(readTable(salesTable, SALES_CSV)).toEqual(sales());
  });

  it('same payment twice → one row; re-running changes nothing', () => {
    const once = mergeTable(salesTable, null, sales());
    const twice = mergeTable(salesTable, once.csv, [...sales(), ...sales()]);
    expect(twice.csv).toBe(once.csv);
    expect(twice.added).toEqual([]);
    expect(twice.rows).toHaveLength(4);
  });

  it('is append-only: an existing row is never changed by a later status', () => {
    const once = mergeTable(salesTable, null, sales());
    const later = { ...(sales()[0] as SaleRow), status: 'refunded' };
    expect(mergeTable(salesTable, once.csv, [later]).csv).toBe(once.csv);
  });

  it('inserts older rows in date order', () => {
    const once = mergeTable(salesTable, SALES_CSV, []);
    const older = { ...(sales()[0] as SaleRow), paymentId: 'pay_Z0', date: '2026-10-01' };
    const merged = mergeTable(salesTable, once.csv, [older]);
    expect(merged.rows.map((r) => r.paymentId)).toEqual([
      'pay_Z0',
      'pay_A1',
      'pay_B2',
      'pay_C3',
      'pay_E5',
    ]);
    expect(merged.added).toEqual([older]);
  });

  it('refunds, settlements and costs round-trip too', () => {
    const r = parseRefund(rawRefunds[0]);
    const s = parseSettlement(rawSettlements[0]);
    if (!r.ok || !s.ok) throw new Error('fixture');
    const refunds = mergeTable(refundsTable, null, [refundRow(r.value)]);
    expect(refunds.csv).toBe(
      'date,refund_id,payment_id,amount_inr,reason_code,approved_by\n2026-10-05,rfnd_R1,pay_C3,399.00,duplicate,owner\n',
    );
    expect(readTable(refundsTable, refunds.csv)).toEqual([refundRow(r.value)]);

    const settlements = mergeTable(settlementsTable, null, [
      settlementRow(s.value),
      settlementRow({ ...s.value, id: 'setl_S0', utrPresent: false }),
    ]);
    expect(settlements.csv).toBe(
      'date,settlement_id,amount_inr,utr_present\n2026-10-05,setl_S0,482.36,no\n2026-10-05,setl_S1,482.36,yes\n',
    );
    expect(readTable(settlementsTable, settlements.csv)).toHaveLength(2);

    const cost = {
      date: '2026-10-05',
      service: 'domain',
      amountPaise: 99900,
      note: 'renewal, 1 year',
    };
    const costs = mergeTable(costsTable, null, [cost, cost]);
    expect(costs.csv).toBe(
      'date,service,amount_inr,note\n2026-10-05,domain,999.00,"renewal, 1 year"\n',
    );
    expect(readTable(costsTable, costs.csv)).toEqual([cost]);
  });

  it('sorts refunds and costs by date, then ID', () => {
    const r = (refundId: string, date: string) => ({
      date,
      refundId,
      paymentId: 'pay_A1',
      amountPaise: 1,
      reasonCode: '',
      approvedBy: '',
    });
    const refunds = mergeTable(refundsTable, null, [
      r('rfnd_B', '2026-10-05'),
      r('rfnd_A', '2026-10-05'),
      r('rfnd_C', '2026-10-04'),
    ]);
    expect(refunds.rows.map((x) => x.refundId)).toEqual(['rfnd_C', 'rfnd_A', 'rfnd_B']);
    const c = (service: string) => ({ date: '2026-10-05', service, amountPaise: 1, note: '' });
    const costs = mergeTable(costsTable, null, [c('r2'), c('github'), c('r2')]);
    expect(costs.rows.map((x) => x.service)).toEqual(['github', 'r2']);
  });

  it('an empty or missing file is just the header', () => {
    expect(mergeTable(costsTable, null, []).csv).toBe('date,service,amount_inr,note\n');
    expect(readTable(costsTable, '  ')).toEqual([]);
  });

  it('refuses a file with a different header or a bad row', () => {
    expect(() => readTable(salesTable, 'date,email\n')).toThrow(/unexpected header/);
    expect(() => readTable(salesTable, '')).not.toThrow();
    expect(() => readTable(salesTable, SALES_CSV.replace('199.00', '199.005'))).toThrow(
      /sales.csv line 2: bad rupee amount/,
    );
    expect(() =>
      readTable(
        settlementsTable,
        'date,settlement_id,amount_inr,utr_present\n2026-10-05,setl_X,1.00,maybe\n',
      ),
    ).toThrow(/utr_present/);
    expect(() =>
      readTable(costsTable, 'date,service,amount_inr,note\n05/10/2026,x,1.00,\n'),
    ).toThrow(/bad date/);
  });

  it('never contains PII — no "@", no phone numbers — even though the API payloads did', () => {
    const r = parseRefund(rawRefunds[0]);
    if (!r.ok) throw new Error('fixture');
    const outputs = [
      mergeTable(salesTable, null, sales()).csv,
      mergeTable(refundsTable, null, [refundRow(r.value)]).csv,
    ];
    for (const csv of outputs) {
      expect(csv).not.toContain('@');
      expect(csv).not.toMatch(/(?<!\d)[6-9]\d{9}(?!\d)/);
      expect(findPii(csv)).toBeNull();
    }
  });
});
