import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateRefund, maskPaymentId, parseThreshold, POLICY_PATH } from '../src/refund.js';

const NOW = new Date('2026-10-06T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('parseThreshold', () => {
  it('reads ₹0 from the real policy', () => {
    const md = readFileSync(join(import.meta.dirname, '..', '..', '..', POLICY_PATH), 'utf8');
    expect(parseThreshold(md)).toBe(0);
  });

  it('parses other values and defaults to 0', () => {
    expect(parseThreshold('may approve refunds up to **₹1,299** (proposal)')).toBe(1299);
    expect(parseThreshold('may approve refunds up to **₹ 299**')).toBe(299);
    expect(parseThreshold('no number here')).toBe(0);
    expect(parseThreshold(null)).toBe(0);
    expect(parseThreshold(undefined)).toBe(0);
  });
});

describe('evaluateRefund — always escalates', () => {
  it('without order data: eligibility unknown, notes say what to check', () => {
    for (const reason of ['changed_mind', 'broken_link', 'double_charge'] as const) {
      const d = evaluateRefund(reason, null, 0, NOW);
      expect(d.eligible).toBeNull();
      expect(d.action).toBe('escalate');
      expect(d.withinThreshold).toBe(false);
      expect(d.notes.join(' ')).toMatch(/order lookup not available/);
    }
  });

  it('change of mind: 7-day window, once per buyer', () => {
    expect(
      evaluateRefund('changed_mind', { purchasedAt: daysAgo(3), refundsForBuyer: 0 }, 0, NOW)
        .eligible,
    ).toBe(true);
    expect(
      evaluateRefund('changed_mind', { purchasedAt: daysAgo(7), refundsForBuyer: 0 }, 0, NOW)
        .eligible,
    ).toBe(true);
    expect(
      evaluateRefund('changed_mind', { purchasedAt: daysAgo(8), refundsForBuyer: 0 }, 0, NOW)
        .eligible,
    ).toBe(false);
    expect(
      evaluateRefund('changed_mind', { purchasedAt: daysAgo(1), refundsForBuyer: 1 }, 0, NOW)
        .eligible,
    ).toBe(false);
    const unknownRefunds = evaluateRefund('changed_mind', { purchasedAt: daysAgo(1) }, 0, NOW);
    expect(unknownRefunds.eligible).toBeNull();
    expect(unknownRefunds.notes.join(' ')).toMatch(/once-per-buyer/);
    const unknownDate = evaluateRefund('changed_mind', { refundsForBuyer: 0 }, 0, NOW);
    expect(unknownDate.eligible).toBeNull();
    expect(unknownDate.notes.join(' ')).toMatch(/Purchase date unknown/);
  });

  it('broken link: only when not fixed within 48 h', () => {
    expect(
      evaluateRefund('broken_link', { linkReportedAt: hoursAgo(49), linkFixed: false }, 0, NOW)
        .eligible,
    ).toBe(true);
    expect(evaluateRefund('broken_link', { linkReportedAt: hoursAgo(47) }, 0, NOW).eligible).toBe(
      false,
    );
    expect(
      evaluateRefund('broken_link', { linkReportedAt: hoursAgo(72), linkFixed: true }, 0, NOW)
        .eligible,
    ).toBe(false);
    expect(evaluateRefund('broken_link', {}, 0, NOW).notes.join(' ')).toMatch(/48 h/);
  });

  it('double charge: two or more charges for the order', () => {
    expect(evaluateRefund('double_charge', { chargesForOrder: 2 }, 0, NOW).eligible).toBe(true);
    expect(evaluateRefund('double_charge', { chargesForOrder: 1 }, 0, NOW).eligible).toBe(false);
  });

  it('threshold ₹0: an eligible ₹199 refund is still above the threshold → owner', () => {
    const d = evaluateRefund('double_charge', { chargesForOrder: 2, amountInr: 199 }, 0, NOW);
    expect(d.eligible).toBe(true);
    expect(d.amountInr).toBe(199);
    expect(d.withinThreshold).toBe(false);
    expect(d.action).toBe('escalate');
  });

  it('even within a future threshold the agent escalates (auto-refunds are not built)', () => {
    const d = evaluateRefund('double_charge', { chargesForOrder: 2, amountInr: 199 }, 299, NOW);
    expect(d.withinThreshold).toBe(true);
    expect(d.action).toBe('escalate');
    expect(d.notes.join(' ')).toMatch(/owner refunds by hand/);
  });
});

describe('maskPaymentId', () => {
  it('keeps the prefix and the last 4 characters', () => {
    expect(maskPaymentId('pay_TESTX7Q2ABCD')).toBe('pay_…ABCD');
    expect(maskPaymentId('pay_ABCDEFGHX7Q2')).toBe('pay_…X7Q2');
    expect(maskPaymentId('weird')).toBe('…');
  });
});
