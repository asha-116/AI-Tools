import { describe, expect, it } from 'vitest';
import { claimStrings } from '../src/i18n/claim.js';
import { formatExpiry, parseClaimResponse, validateClaim } from '../src/lib/claim.js';

const DL = 'https://toolshop-download.example.workers.dev';

describe('validateClaim', () => {
  it('trims and lower-cases, and accepts a Razorpay payment id', () => {
    expect(validateClaim(' pay_ABC123xyz ', ' Me@Example.COM ')).toEqual({
      ok: true,
      paymentId: 'pay_ABC123xyz',
      email: 'me@example.com',
    });
  });

  it('rejects other ids and bad emails', () => {
    for (const id of ['', 'ABC123', 'order_ABC', 'pay_', 'pay_abc-1', `pay_${'a'.repeat(41)}`]) {
      expect(validateClaim(id, 'a@b.co')).toEqual({ ok: false, error: 'paymentId' });
    }
    for (const mail of ['', 'a@b', 'a b@c.d', `${'a'.repeat(250)}@b.co`]) {
      expect(validateClaim('pay_A1', mail)).toEqual({ ok: false, error: 'email' });
    }
  });
});

describe('parseClaimResponse', () => {
  const good = {
    ok: true,
    product: 'bundle',
    expires_at: '2026-10-08T10:00:00.000Z',
    links: [
      { file: 'a.xlsx', url: `${DL}/d/tok1` },
      { file: 'b.xlsx', url: `${DL}/d/tok2` },
    ],
  };

  it('returns the links from a good response', () => {
    expect(parseClaimResponse(200, good, DL)).toEqual({
      ok: true,
      expiresAt: '2026-10-08T10:00:00.000Z',
      links: [
        { file: 'a.xlsx', url: `${DL}/d/tok1` },
        { file: 'b.xlsx', url: `${DL}/d/tok2` },
      ],
    });
  });

  it('maps API errors to messages', () => {
    expect(parseClaimResponse(404, {}, DL)).toEqual({ ok: false, error: 'notFound' });
    expect(parseClaimResponse(409, {}, DL)).toEqual({ ok: false, error: 'needsSupport' });
    expect(parseClaimResponse(429, {}, DL)).toEqual({ ok: false, error: 'rate' });
    expect(parseClaimResponse(500, {}, DL)).toEqual({ ok: false, error: 'generic' });
    expect(parseClaimResponse(200, null, DL)).toEqual({ ok: false, error: 'generic' });
  });

  it('refuses links to anywhere but the download Worker', () => {
    const bad = [
      { file: 'a', url: 'javascript:alert(1)' },
      { file: 'a', url: 'https://evil.example/d/tok' },
      { file: 'a', url: `${DL}/other` },
      { file: 'a', url: 'not a url' },
      { file: 1, url: `${DL}/d/x` },
      'x',
    ];
    for (const l of bad) {
      expect(parseClaimResponse(200, { ...good, links: [l] }, DL), JSON.stringify(l)).toEqual({
        ok: false,
        error: 'generic',
      });
    }
    expect(parseClaimResponse(200, { ...good, links: [] }, DL).ok).toBe(false);
    expect(parseClaimResponse(200, { ...good, expires_at: 5 }, DL).ok).toBe(false);
  });
});

describe('formatExpiry', () => {
  it('formats in Indian English and Hindi, and passes through bad input', () => {
    const iso = '2026-10-08T10:00:00.000Z';
    expect(formatExpiry(iso, 'en')).toMatch(/2026/);
    expect(formatExpiry(iso, 'hi')).toMatch(/2026|२०२६/);
    expect(formatExpiry('nope', 'en')).toBe('nope');
  });
});

describe('claim strings', () => {
  it('has the same non-empty keys in EN and HI with placeholders kept', () => {
    expect(Object.keys(claimStrings.hi).sort()).toEqual(Object.keys(claimStrings.en).sort());
    for (const lang of ['en', 'hi'] as const) {
      for (const [k, v] of Object.entries(claimStrings[lang])) {
        expect(v.trim(), `${lang}.${k}`).not.toBe('');
      }
      expect(claimStrings[lang].linksNote).toContain('{date}');
      expect(claimStrings[lang].supportLine).toContain('{email}');
    }
  });
});
