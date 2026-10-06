/**
 * Money is integer paise everywhere inside the Controller. Rupee strings only appear at the
 * edges: CSV columns (`1234.50`) and reports (`₹1,234.50`, Indian digit grouping).
 */

const RUPEES_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

function assertPaise(paise: number): void {
  if (!Number.isSafeInteger(paise)) throw new Error(`amount must be integer paise: ${paise}`);
}

/** 123450 → "1234.50" (no grouping, no symbol): the CSV form. */
export function paiseToRupees(paise: number): string {
  assertPaise(paise);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

/** "1234.5" → 123450. Exact (string arithmetic, no floating point). */
export function rupeesToPaise(rupees: string): number {
  const m = RUPEES_RE.exec(rupees.trim());
  if (!m) throw new Error(`bad rupee amount: ${rupees}`);
  const paise = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  assertPaise(paise);
  return m[1] === '-' && paise !== 0 ? -paise : paise;
}

/** Indian digit grouping: "1234567" → "12,34,567". */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',');
  return `${rest},${digits.slice(-3)}`;
}

/** 12345678 paise → "₹1,23,456.78"; negatives as "-₹…". */
export function formatInr(paise: number): string {
  const plain = paiseToRupees(paise);
  const negative = paise < 0;
  const [whole, frac] = (negative ? plain.slice(1) : plain).split('.') as [string, string];
  return `${negative ? '-' : ''}₹${groupIndian(whole)}.${frac}`;
}
