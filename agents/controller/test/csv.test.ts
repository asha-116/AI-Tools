import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../src/csv.js';
import { assertNoPii, findPii } from '../src/pii.js';

describe('csv', () => {
  it('round-trips quotes, commas and newlines (RFC 4180)', () => {
    const rows = [
      ['a', 'b,c', 'say "hi"'],
      ['line\nbreak', '', 'x'],
    ];
    const text = toCsv(['h1', 'h2', 'h3'], rows);
    expect(text).toBe('h1,h2,h3\na,"b,c","say ""hi"""\n"line\nbreak",,x\n');
    expect(parseCsv(text)).toEqual([['h1', 'h2', 'h3'], ...rows]);
  });

  it('accepts CRLF, skips blank lines, handles a missing final newline', () => {
    expect(parseCsv('a,b\r\n\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('')).toEqual([]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/unterminated/);
  });
});

describe('PII guard', () => {
  it('flags emails and Indian mobile numbers', () => {
    expect(findPii('buyer@example.com')).toMatch(/@/);
    expect(findPii('call 9876543210 now')).toMatch(/phone/);
    expect(findPii('+91 9876543210')).toMatch(/phone/);
    expect(findPii('09876543210')).toMatch(/phone/);
    expect(() => assertNoPii('x@y', 'sales.csv')).toThrow(/sales.csv/);
  });

  it('does not flag Razorpay IDs or amounts', () => {
    expect(findPii('pay_9876543210abcd,199.00,setl_A9876543210')).toBeNull();
    expect(findPii('2026-10-05,pay_ABC,order_X,lead-tracker,199.00,3.98,0.72,captured')).toBeNull();
    expect(() => assertNoPii('ok', 'x')).not.toThrow();
  });
});
