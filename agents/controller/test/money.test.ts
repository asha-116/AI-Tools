import { describe, expect, it } from 'vitest';
import { formatInr, paiseToRupees, rupeesToPaise } from '../src/money.js';

// Indian digit grouping (lakh/crore): the last three digits, then groups of two —
// e.g. ₹1,23,456.78 and ₹1,00,00,000.00 (one crore), as used by the RBI and Indian banks.

describe('paise ↔ rupee strings', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [19900, '199.00'],
    [123450, '1234.50'],
    [-470, '-4.70'],
  ])('%i paise ↔ %s', (paise, rupees) => {
    expect(paiseToRupees(paise)).toBe(rupees);
    expect(rupeesToPaise(rupees)).toBe(paise);
  });

  it('parses without floating-point error', () => {
    // 0.1 + 0.2 style traps: 1.1 rupees must be 110 paise exactly.
    expect(rupeesToPaise('1.1')).toBe(110);
    expect(rupeesToPaise('4.7')).toBe(470);
    expect(rupeesToPaise('199')).toBe(19900);
    expect(rupeesToPaise('-0.00')).toBe(0);
  });

  it('rejects anything that is not a plain rupee amount', () => {
    for (const bad of ['', '1.234', '₹199', '1,234.00', 'abc', '1e3']) {
      expect(() => rupeesToPaise(bad)).toThrow(/bad rupee amount/);
    }
    expect(() => paiseToRupees(1.5)).toThrow(/integer paise/);
  });
});

describe('formatInr', () => {
  it.each([
    [0, '₹0.00'],
    [99, '₹0.99'],
    [99900, '₹999.00'],
    [123400, '₹1,234.00'],
    [12345678, '₹1,23,456.78'],
    [1000000000, '₹1,00,00,000.00'],
    [-123400, '-₹1,234.00'],
  ])('%i paise → %s', (paise, text) => {
    expect(formatInr(paise)).toBe(text);
  });
});
