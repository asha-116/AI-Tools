import { describe, expect, it } from 'vitest';
import { formatInr, formatInrExact, parseAmount } from '../src/lib/format.js';

describe('format', () => {
  it('parses Indian-formatted amounts', () => {
    expect(parseAmount('1,00,00,000')).toBe(10000000);
    expect(parseAmount('')).toBeNaN();
  });

  it('formats to the rupee', () => {
    expect(formatInr(123456.6)).toBe('₹1,23,457');
  });

  it('shows paise only when present', () => {
    expect(formatInrExact(37500)).toBe('₹37,500');
    expect(formatInrExact(33.34)).toBe('₹33.34');
    expect(formatInrExact(15432.09)).toBe('₹15,432.09');
    expect(formatInrExact(0.1)).toBe('₹0.10');
    expect(formatInrExact(0)).toBe('₹0');
  });
});
