/**
 * Last line of defence before anything the Controller produces is written to git
 * (AGENTS.md hard rule 2). The Razorpay parser already drops personal fields; this guard
 * fails loudly if something slipped through anyway.
 */

/** An Indian mobile number (optionally +91 / 91 / 0 prefixed), not embedded in a longer token. */
const PHONE_RE = /(?<![A-Za-z0-9_])(?:\+?91[\s-]?|0)?[6-9]\d{9}(?![A-Za-z0-9_])/;

export function findPii(text: string): string | null {
  if (text.includes('@')) return 'email-like "@"';
  if (PHONE_RE.test(text)) return 'phone-number-like digits';
  return null;
}

export function assertNoPii(text: string, where: string): void {
  const found = findPii(text);
  if (found) throw new Error(`${where}: refusing to write output containing ${found}`);
}
