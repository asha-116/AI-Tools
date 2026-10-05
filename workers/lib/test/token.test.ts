import { describe, expect, it } from 'vitest';
import { base64urlEncode } from '../src/crypto.js';
import { MAX_TOKEN_TTL_SECONDS, signDownloadToken, verifyDownloadToken } from '../src/token.js';

const SECRET = 'dl-secret';
const NOW = 1_790_000_000; // 2026-09-21
const claim = {
  paymentId: 'pay_TEST123',
  productId: 'lead-tracker',
  fileKey: 'lead-tracker/v1/lead-tracker.xlsx',
};

describe('download tokens', () => {
  it('verifies a fresh token and returns its claims', async () => {
    const t = await signDownloadToken(claim, NOW + 3600, SECRET);
    expect(await verifyDownloadToken(t, SECRET, NOW)).toEqual({
      ok: true,
      claims: { ...claim, expiresAt: NOW + 3600 },
    });
  });

  it('rejects an expired token, including at the exact expiry second', async () => {
    const t = await signDownloadToken(claim, NOW + 60, SECRET);
    expect(await verifyDownloadToken(t, SECRET, NOW + 60)).toEqual({ ok: false, error: 'expired' });
    expect(await verifyDownloadToken(t, SECRET, NOW + 61)).toEqual({ ok: false, error: 'expired' });
  });

  it('refuses to sign or accept a lifetime above 72 hours', async () => {
    expect(MAX_TOKEN_TTL_SECONDS).toBe(72 * 3600);
    await expect(
      signDownloadToken(claim, NOW + MAX_TOKEN_TTL_SECONDS + 1, SECRET, NOW),
    ).rejects.toThrow(/72/);
    // A token minted elsewhere with a far expiry (e.g. leaked secret misuse) is still refused.
    const { hmacBase64url } = await import('../src/crypto.js');
    const payload = base64urlEncode(
      new TextEncoder().encode(
        JSON.stringify({ v: 1, pay: 'pay_x', prd: 'p', key: 'k', exp: NOW + 30 * 86400 }),
      ),
    );
    const far = `${payload}.${await hmacBase64url(SECRET, `dl1.${payload}`)}`;
    expect(await verifyDownloadToken(far, SECRET, NOW)).toEqual({ ok: false, error: 'invalid' });
  });

  it('rejects a token signed with another secret', async () => {
    const t = await signDownloadToken(claim, NOW + 60, 'other');
    expect(await verifyDownloadToken(t, SECRET, NOW)).toEqual({ ok: false, error: 'invalid' });
  });

  it('rejects a tampered payload or signature', async () => {
    const t = await signDownloadToken(claim, NOW + 60, SECRET);
    const [payload = '', sig = ''] = t.split('.');
    const forged = base64urlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          v: 1,
          pay: claim.paymentId,
          prd: 'bundle',
          key: claim.fileKey,
          exp: NOW + 60,
        }),
      ),
    );
    expect(await verifyDownloadToken(`${forged}.${sig}`, SECRET, NOW)).toEqual({
      ok: false,
      error: 'invalid',
    });
    const flipped = (sig.startsWith('A') ? 'B' : 'A') + sig.slice(1);
    expect(await verifyDownloadToken(`${payload}.${flipped}`, SECRET, NOW)).toEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('rejects malformed tokens without throwing', async () => {
    for (const bad of ['', 'abc', 'a.b.c', '.', 'x.', '.y', '%%%.%%%']) {
      expect(await verifyDownloadToken(bad, SECRET, NOW)).toEqual({ ok: false, error: 'invalid' });
    }
  });

  it('rejects a correctly signed payload with the wrong shape', async () => {
    const { hmacBase64url } = await import('../src/crypto.js');
    const enc = (o: unknown) => base64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
    for (const body of [
      { v: 2, pay: 'pay_x', prd: 'p', key: 'k', exp: NOW + 60 },
      { v: 1, pay: 7, prd: 'p', key: 'k', exp: NOW + 60 },
      { v: 1, pay: 'pay_x', prd: 'p', key: 'k', exp: 'soon' },
      [1, 2, 3],
      'text',
    ]) {
      const p = enc(body);
      const t = `${p}.${await hmacBase64url(SECRET, `dl1.${p}`)}`;
      expect(await verifyDownloadToken(t, SECRET, NOW)).toEqual({ ok: false, error: 'invalid' });
    }
    const notJson = base64urlEncode(new TextEncoder().encode('{nope'));
    const t = `${notJson}.${await hmacBase64url(SECRET, `dl1.${notJson}`)}`;
    expect(await verifyDownloadToken(t, SECRET, NOW)).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuses an empty secret', async () => {
    await expect(signDownloadToken(claim, NOW + 60, '')).rejects.toThrow(/secret/);
    const t = await signDownloadToken(claim, NOW + 60, SECRET);
    expect(await verifyDownloadToken(t, '', NOW)).toEqual({ ok: false, error: 'invalid' });
  });
});
