import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base64urlDecode,
  base64urlEncode,
  hmacHex,
  timingSafeEqual,
  verifyRazorpaySignature,
} from '../src/crypto.js';

// Expected values come from Node's own crypto module, an implementation independent of the
// WebCrypto code under test.
const nodeHex = (secret: string, msg: string) =>
  createHmac('sha256', secret).update(msg, 'utf8').digest('hex');

describe('hmacHex', () => {
  it('matches the RFC 4231 test case 2 vector', async () => {
    expect(await hmacHex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('matches node:crypto for UTF-8 input', async () => {
    const body = '{"event":"payment.captured","note":"₹199 — लीड"}';
    expect(await hmacHex('s3cret', body)).toBe(nodeHex('s3cret', body));
  });
});

describe('verifyRazorpaySignature', () => {
  const secret = 'whsec_test';
  const body = '{"entity":"event","event":"payment.captured"}';

  it('accepts the hex HMAC-SHA256 of the raw body', async () => {
    expect(await verifyRazorpaySignature(body, nodeHex(secret, body), secret)).toBe(true);
  });

  it('accepts upper-case hex', async () => {
    expect(await verifyRazorpaySignature(body, nodeHex(secret, body).toUpperCase(), secret)).toBe(
      true,
    );
  });

  it('rejects a signature for a different body, secret, or a missing/garbled one', async () => {
    const sig = nodeHex(secret, body);
    expect(await verifyRazorpaySignature(body + ' ', sig, secret)).toBe(false);
    expect(await verifyRazorpaySignature(body, nodeHex('other', body), secret)).toBe(false);
    expect(await verifyRazorpaySignature(body, null, secret)).toBe(false);
    expect(await verifyRazorpaySignature(body, '', secret)).toBe(false);
    expect(await verifyRazorpaySignature(body, sig.slice(0, 63), secret)).toBe(false);
  });

  it('refuses to verify with an empty secret', async () => {
    expect(await verifyRazorpaySignature(body, nodeHex('', body), '')).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('compares strings of equal and different length', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('base64url', () => {
  it('round-trips bytes and matches Node’s encoding', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const enc = base64urlEncode(bytes);
    expect(enc).toBe(Buffer.from(bytes).toString('base64url'));
    expect([...(base64urlDecode(enc) ?? [])]).toEqual([...bytes]);
  });

  it('returns null for characters outside the alphabet', () => {
    expect(base64urlDecode('ab+/')).toBeNull();
    expect(base64urlDecode('a')).toBeNull();
  });
});
