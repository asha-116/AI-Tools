// company/policies/refund-policy.md, applied deterministically. The agent never issues a refund
// itself: with the agent threshold at ₹0 every request goes to the owner.

import type { RefundReason } from './classify.js';

export const POLICY_PATH = 'company/policies/refund-policy.md';
export const REFUND_WINDOW_DAYS = 7;
export const BROKEN_LINK_FIX_HOURS = 48;

/**
 * The agent threshold in ₹ from the policy text ("may approve refunds up to **₹0**").
 * Missing or unreadable → 0 (the safe value).
 */
export function parseThreshold(policyMarkdown: string | null | undefined): number {
  const m = /approve refunds up to \*\*₹\s?([\d,]+)\*\*/i.exec(policyMarkdown ?? '');
  return m ? Number((m[1] as string).replace(/,/g, '')) : 0;
}

/** What an order lookup can tell us. Unknown fields stay undefined. */
export interface OrderFacts {
  purchasedAt?: Date;
  amountInr?: number;
  /** Refunds this buyer already got (policy: "once per buyer" for change-of-mind). */
  refundsForBuyer?: number;
  /** Successful charges for this order (≥ 2 = double charge). */
  chargesForOrder?: number;
  /** When the buyer first reported the broken link, and whether it was fixed since. */
  linkReportedAt?: Date;
  linkFixed?: boolean;
}

/** Order lookup by payment ID (Worker API — not built yet; PROCEDURE.md "Inputs"). */
export interface OrderLookup {
  find(paymentId: string): Promise<OrderFacts | null>;
}

export interface RefundDecision {
  reason: RefundReason;
  /** true / false by policy, null when the facts needed are missing. */
  eligible: boolean | null;
  amountInr: number | null;
  /** Human-readable findings for the owner (no PII). */
  notes: string[];
  /** Always 'escalate' while auto-refunds are not built; see decide(). */
  action: 'escalate';
  withinThreshold: boolean;
}

const DAY_MS = 86_400_000;

/** Evaluate the three policy cases. Pure; `now` injected. */
export function evaluateRefund(
  reason: RefundReason,
  facts: OrderFacts | null,
  threshold: number,
  now: Date,
): RefundDecision {
  const notes: string[] = [];
  let eligible: boolean | null = null;
  const f = facts ?? {};
  if (!facts) notes.push('No order data (order lookup not available): check D1 `orders` by hand.');

  if (reason === 'double_charge') {
    if (f.chargesForOrder === undefined)
      notes.push('Double charge claimed: number of charges unknown.');
    else {
      eligible = f.chargesForOrder >= 2;
      notes.push(`Charges recorded for this order: ${f.chargesForOrder}.`);
    }
  } else if (reason === 'broken_link') {
    if (f.linkFixed === true) {
      eligible = false;
      notes.push('Broken link reported, but it has been fixed since.');
    } else if (f.linkReportedAt === undefined) {
      notes.push(
        `Broken link claimed: refund only if not fixed within ${BROKEN_LINK_FIX_HOURS} h of the report. Try the download fix first.`,
      );
    } else {
      const hours = (now.getTime() - f.linkReportedAt.getTime()) / 3_600_000;
      eligible = hours >= BROKEN_LINK_FIX_HOURS;
      notes.push(`Link reported ${Math.floor(hours)} h ago and not fixed.`);
    }
  } else {
    const days =
      f.purchasedAt === undefined ? undefined : (now.getTime() - f.purchasedAt.getTime()) / DAY_MS;
    if (days === undefined) notes.push('Purchase date unknown: 7-day window cannot be checked.');
    else notes.push(`Purchased ${Math.floor(days)} day(s) ago (window: ${REFUND_WINDOW_DAYS}).`);
    if (f.refundsForBuyer !== undefined && f.refundsForBuyer > 0) {
      eligible = false;
      notes.push('Buyer already had a refund (change-of-mind refunds: once per buyer).');
    } else if (days !== undefined && days > REFUND_WINDOW_DAYS) {
      eligible = false;
    } else if (days !== undefined && f.refundsForBuyer === 0) {
      eligible = true;
    } else if (f.refundsForBuyer === undefined) {
      notes.push('Earlier refunds for this buyer unknown (once-per-buyer rule).');
    }
  }

  const amountInr = f.amountInr ?? null;
  const withinThreshold = eligible === true && amountInr !== null && amountInr <= threshold;
  notes.push(
    `Agent refund threshold: ₹${threshold}. ` +
      (withinThreshold
        ? 'Within threshold, but automatic refunds are not built: the owner refunds by hand.'
        : 'Above the threshold or not clearly eligible: the owner decides.'),
  );
  return { reason, eligible, amountInr, notes, action: 'escalate', withinThreshold };
}

/** `pay_ABCDEFGHX7Q2` → `pay_…X7Q2` (safe for Issues and logs). */
export function maskPaymentId(id: string): string {
  const m = /^([a-z]+_)[A-Za-z0-9]*?([A-Za-z0-9]{4})$/.exec(id);
  return m ? `${m[1] as string}…${m[2] as string}` : '…';
}
