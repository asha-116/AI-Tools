/** Number parsing/formatting shared by all tools. Pure — unit-tested. */

/** Accepts "25,00,000", "₹ 25 00 000" or "2500000". Empty → NaN. */
export function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[,\s₹]/g, '');
  return cleaned === '' ? Number.NaN : Number(cleaned);
}

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const paise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹ with Indian digit grouping (₹25,00,000), rounded to the rupee. */
export function formatInr(value: number): string {
  return rupees.format(Math.round(value));
}

/** ₹ with Indian grouping; shows paise only when the amount has them (₹37,500 vs ₹33.34). */
export function formatInrExact(value: number): string {
  const p = Math.round(value * 100);
  return p % 100 === 0 ? rupees.format(p / 100) : paise.format(p / 100);
}
