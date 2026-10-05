import { describe, expect, it } from 'vitest';
import leadSpec from '../../products/lead-tracker/spec.json' with { type: 'json' };
import ledgerSpec from '../../products/commission-ledger/spec.json' with { type: 'json' };
import commissionKnown from './fixtures/commission-known-answers.json' with { type: 'json' };
import {
  callList,
  COMMISSION_LIMITS,
  followUpBucket,
  LEAD_SOURCES,
  LEAD_STATUSES,
  leadSummary,
  ledgerDeal,
  ledgerTotals,
  type LeadStatus,
  type LedgerDealInput,
} from '../src/index.js';

const leadKnown = leadSpec.known_answers;
const today = leadKnown.today;

function columnOptions(sheetId: string, columnId: string): string[] {
  type Column = { id: string; options?: Array<{ id: string }> };
  const sheet = leadSpec.sheets.find((s) => s.id === sheetId) as { columns?: Column[] } | undefined;
  const col = sheet?.columns?.find((c) => c.id === columnId);
  return (col?.options ?? []).map((o) => o.id);
}

describe('lead-tracker spec agrees with the code', () => {
  it('status and source lists match the spec options', () => {
    expect([...LEAD_STATUSES]).toEqual(columnOptions('leads', 'status'));
    expect([...LEAD_SOURCES]).toEqual(columnOptions('leads', 'source'));
  });
});

describe('followUpBucket — spec known answers', () => {
  it.each(leadKnown.follow_up)('$status, next $next → $expect', ({ status, next, expect: e }) => {
    expect(followUpBucket(status as LeadStatus, next, today)).toBe(e);
  });
});

describe('followUpBucket — edge cases', () => {
  it('treats an empty date like a missing one (sheet: L2="")', () => {
    expect(followUpBucket('new', '', today)).toBe('no-date');
  });

  it('closed wins even when the date is missing or overdue', () => {
    expect(followUpBucket('won', null, today)).toBe('closed');
    expect(followUpBucket('lost', '2020-01-01', today)).toBe('closed');
  });

  it('handles month and leap-year boundaries', () => {
    expect(followUpBucket('new', '2028-02-29', '2028-03-01')).toBe('overdue');
    expect(followUpBucket('new', '2028-02-29', '2028-02-28')).toBe('upcoming');
  });

  it('rejects an unknown status', () => {
    expect(() => followUpBucket('pending' as LeadStatus, null, today)).toThrow(RangeError);
  });

  it.each(['2026-13-01', '2026-02-30', '2027-02-29', '2026-10-5', '05-10-2026', 'x', '2026-00-10'])(
    'rejects bad date %s',
    (bad) => {
      expect(() => followUpBucket('new', bad, today)).toThrow(RangeError);
      expect(() => followUpBucket('new', null, bad)).toThrow(RangeError);
    },
  );

  it('rejects a non-string date', () => {
    expect(() => followUpBucket('new', 20261005 as unknown as string, today)).toThrow(RangeError);
  });
});

describe('callList', () => {
  it('matches the spec known answer', () => {
    const rows = leadKnown.call_list.rows.map((r) => ({ ...r, status: r.status as LeadStatus }));
    expect(callList(rows, today)).toEqual(leadKnown.call_list.expect);
  });

  it('keeps input order for equal dates (stable)', () => {
    expect(
      callList(
        [
          { name: 'Z', status: 'new', next: '2026-10-01' },
          { name: 'Y', status: 'contacted', next: '2026-09-01' },
          { name: 'X', status: 'negotiating', next: '2026-10-01' },
          { name: 'W', status: 'new', next: '2026-10-05' },
        ],
        today,
      ),
    ).toEqual(['Y', 'Z', 'X', 'W']);
  });

  it('returns an empty list when nobody is due', () => {
    expect(callList([], today)).toEqual([]);
    expect(callList([{ name: 'A', status: 'new', next: '2026-10-06' }], today)).toEqual([]);
  });

  it('rejects a row without a name', () => {
    expect(() => callList([{ name: '  ', status: 'new', next: today }], today)).toThrow(RangeError);
  });

  it('rejects a non-array', () => {
    expect(() => callList(null as unknown as [], today)).toThrow(RangeError);
  });
});

describe('leadSummary', () => {
  it('matches the spec known answer', () => {
    const rows = leadKnown.summary.rows.map((r) => ({ ...r, status: r.status as LeadStatus }));
    expect(leadSummary(rows)).toEqual(leadKnown.summary.expect);
  });

  it('win rate is null with no closed leads, and rounds to 1 decimal', () => {
    expect(leadSummary([]).winRatePercent).toBeNull();
    expect(leadSummary([{ status: 'new', source: 'call' }])).toEqual({
      total: 1,
      open: 1,
      won: 0,
      lost: 0,
      winRatePercent: null,
      byStatus: { new: 1 },
      bySource: { call: 1 },
    });
    // 1 won of 3 closed = 33.333… → 33.3; 2 of 3 = 66.666… → 66.7.
    const one = leadSummary([
      { status: 'won', source: 'call' },
      { status: 'lost', source: 'call' },
      { status: 'lost', source: 'call' },
    ]);
    expect(one.winRatePercent).toBe(33.3);
    const two = leadSummary([
      { status: 'won', source: 'call' },
      { status: 'won', source: 'call' },
      { status: 'lost', source: 'call' },
    ]);
    expect(two.winRatePercent).toBe(66.7);
    expect(leadSummary([{ status: 'lost', source: 'call' }]).winRatePercent).toBe(0);
  });

  it('leaves a blank source out of bySource but counts the lead', () => {
    const r = leadSummary([
      { status: 'new', source: '' },
      { status: 'new' },
      { status: 'won', source: 'other' },
    ]);
    expect(r.total).toBe(3);
    expect(r.bySource).toEqual({ other: 1 });
  });

  it('rejects unknown statuses and sources', () => {
    expect(() => leadSummary([{ status: 'maybe' as LeadStatus, source: 'call' }])).toThrow(
      RangeError,
    );
    expect(() => leadSummary([{ status: 'new', source: 'billboard' }])).toThrow(RangeError);
    expect(() => leadSummary('x' as unknown as [])).toThrow(RangeError);
  });
});

describe('ledgerDeal — spec known answers', () => {
  it.each(ledgerSpec.known_answers.deals)('$name', ({ input, expect: e }) => {
    expect(ledgerDeal(input as LedgerDealInput)).toEqual(e);
  });
});

describe('ledgerDeal — agrees with published commission examples', () => {
  const singleParty = commissionKnown.cases.filter((c) => c.input.parties.length === 1);
  const allCases = commissionKnown.cases;

  it('has single-party cases to check', () => {
    expect(singleParty.length).toBeGreaterThan(0);
  });

  it.each(allCases)('$name', ({ input, expect: e }) => {
    const c = input.commission as { type: string; percent?: number; amount?: number };
    const deal: LedgerDealInput =
      c.type === 'fixed'
        ? { fixedCommission: c.amount, gstPercent: input.gstPercent, payments: [] }
        : {
            dealValue: input.dealValue,
            commissionPercent: c.percent,
            gstPercent: input.gstPercent,
            payments: [],
          };
    const r = ledgerDeal(deal);
    expect(r.commission).toBe(e.gross);
    expect(r.gst).toBe(e.gst);
    expect(r.invoiced).toBe(e.totalPayable);
  });
});

const pct: LedgerDealInput = {
  dealValue: 7500000,
  commissionPercent: 1.5,
  gstPercent: 18,
  payments: [],
};

describe('ledgerDeal — rounding and status', () => {
  it('rounds half away from zero to the paisa (sheet ROUND)', () => {
    // ₹1,001 × 0.05% = ₹0.5005 → 0.50; ₹1,010 × 0.05% = 0.505 → 0.51 (half up).
    expect(
      ledgerDeal({ dealValue: 1001, commissionPercent: 0.05, gstPercent: 0, payments: [] })
        .commission,
    ).toBe(0.5);
    expect(
      ledgerDeal({ dealValue: 1010, commissionPercent: 0.05, gstPercent: 0, payments: [] })
        .commission,
    ).toBe(0.51);
    // ₹1.005 fixed → 1.01 (no binary artefact).
    expect(ledgerDeal({ fixedCommission: 1.005, gstPercent: 0, payments: [] }).commission).toBe(
      1.01,
    );
    // GST on ₹2.50 at 18% = 0.45; on ₹0.25 at 18% = 0.045 → 0.05.
    expect(ledgerDeal({ fixedCommission: 0.25, gstPercent: 18, payments: [] }).gst).toBe(0.05);
  });

  it('sums payments to the paisa', () => {
    const r = ledgerDeal({ fixedCommission: 0.3, gstPercent: 0, payments: [0.1, 0.2] });
    expect(r.received).toBe(0.3);
    expect(r.pending).toBe(0);
    expect(r.status).toBe('paid');
  });

  it('part-paid, due and paid boundaries', () => {
    const invoiced = ledgerDeal(pct).invoiced; // 112500 + 20250
    expect(invoiced).toBe(132750);
    expect(ledgerDeal({ ...pct, payments: [0.01] }).status).toBe('part-paid');
    expect(ledgerDeal({ ...pct, payments: [132749.99] }).status).toBe('part-paid');
    expect(ledgerDeal({ ...pct, payments: [132749.99] }).pending).toBe(0.01);
    expect(ledgerDeal({ ...pct, payments: [132750] }).status).toBe('paid');
    expect(ledgerDeal({ ...pct, payments: [0] }).status).toBe('due');
  });

  it('co-broker share at 100% leaves nothing for me', () => {
    const r = ledgerDeal({ ...pct, coBrokerPercent: 100 });
    expect(r.coBrokerAmount).toBe(112500);
    expect(r.myShare).toBe(0);
  });

  it('a 0% commission bills nothing and counts as paid, as the sheet does', () => {
    const r = ledgerDeal({ ...pct, commissionPercent: 0 });
    expect(r).toMatchObject({ commission: 0, invoiced: 0, pending: 0, status: 'paid' });
  });

  it('accepts the limits exactly', () => {
    expect(
      ledgerDeal({
        dealValue: COMMISSION_LIMITS.maxDealValue,
        commissionPercent: COMMISSION_LIMITS.maxCommissionPercent,
        gstPercent: COMMISSION_LIMITS.maxGstPercent,
        payments: [],
      }).commission,
    ).toBe(2_000_000_000);
    expect(
      ledgerDeal({ fixedCommission: COMMISSION_LIMITS.maxFixedAmount, gstPercent: 0, payments: [] })
        .commission,
    ).toBe(COMMISSION_LIMITS.maxFixedAmount);
  });
});

describe('ledgerDeal — bad input', () => {
  const bad: Array<[string, LedgerDealInput]> = [
    ['no commission at all', { gstPercent: 0, payments: [] }],
    ['percent without deal value', { commissionPercent: 2, gstPercent: 0, payments: [] }],
    ['deal value without percent', { dealValue: 100000, gstPercent: 0, payments: [] }],
    ['zero deal value', { ...pct, dealValue: 0 }],
    ['deal value too large', { ...pct, dealValue: COMMISSION_LIMITS.maxDealValue + 1 }],
    ['NaN deal value', { ...pct, dealValue: Number.NaN }],
    ['negative percent', { ...pct, commissionPercent: -1 }],
    ['percent too large', { ...pct, commissionPercent: 20.01 }],
    ['infinite percent', { ...pct, commissionPercent: Number.POSITIVE_INFINITY }],
    ['zero fixed', { fixedCommission: 0, gstPercent: 0, payments: [] }],
    [
      'fixed too large',
      { fixedCommission: COMMISSION_LIMITS.maxFixedAmount + 1, gstPercent: 0, payments: [] },
    ],
    ['NaN fixed', { fixedCommission: Number.NaN, gstPercent: 0, payments: [] }],
    ['negative GST', { ...pct, gstPercent: -1 }],
    ['GST too large', { ...pct, gstPercent: 29 }],
    ['missing GST', { ...pct, gstPercent: undefined as unknown as number }],
    ['negative co-broker', { ...pct, coBrokerPercent: -5 }],
    ['co-broker over 100', { ...pct, coBrokerPercent: 100.5 }],
    ['NaN co-broker', { ...pct, coBrokerPercent: Number.NaN }],
    ['negative payment', { ...pct, payments: [100, -1] }],
    ['NaN payment', { ...pct, payments: [Number.NaN] }],
    ['payments not an array', { ...pct, payments: 5 as unknown as number[] }],
  ];
  it.each(bad)('%s', (_name, input) => {
    expect(() => ledgerDeal(input)).toThrow(RangeError);
  });
});

describe('ledgerTotals', () => {
  it('adds up the spec known-answer deals to the paisa', () => {
    const deals = ledgerSpec.known_answers.deals.map((d) => ledgerDeal(d.input as LedgerDealInput));
    expect(ledgerTotals(deals)).toEqual({
      // 200000 + 25000 + 71025 + 41666.66 + 10000 + 75000
      commission: 422691.66,
      // 236000 + 25000 + 71025 + 49166.66 + 10000 + 88500
      invoiced: 479691.66,
      // 118000 + 0 + 71025 + 0 + 12000 + 0
      received: 201025,
      // 118000 + 25000 + 0 + 49166.66 + 0 + 88500
      pending: 280666.66,
      // 100000 + 25000 + 71025 + 29166.66 + 10000 + 75000
      myShare: 310191.66,
    });
  });

  it('has no float artefacts', () => {
    const tenth = ledgerDeal({ fixedCommission: 0.1, gstPercent: 0, payments: [] });
    const fifth = ledgerDeal({ fixedCommission: 0.2, gstPercent: 0, payments: [] });
    expect(ledgerTotals([tenth, fifth]).commission).toBe(0.3);
  });

  it('is all zeros for no deals', () => {
    expect(ledgerTotals([])).toEqual({
      commission: 0,
      invoiced: 0,
      received: 0,
      pending: 0,
      myShare: 0,
    });
  });

  it('rejects bad input', () => {
    expect(() => ledgerTotals(null as unknown as [])).toThrow(RangeError);
    const d = ledgerDeal(pct);
    expect(() => ledgerTotals([{ ...d, received: Number.NaN }])).toThrow(RangeError);
  });
});
