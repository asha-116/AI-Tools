import { base64urlDecode, base64urlEncode, hmacBase64url, timingSafeEqual } from './crypto.js';

/** Download links stop working after at most 72 hours (docs/ROADMAP.md, Phase 3). */
export const MAX_TOKEN_TTL_SECONDS = 72 * 3600;
const DOMAIN = 'dl1.';

export interface DownloadClaims {
  paymentId: string;
  productId: string;
  fileKey: string;
}

export type VerifyResult =
  | { ok: true; claims: DownloadClaims & { expiresAt: number } }
  | { ok: false; error: 'invalid' | 'expired' };

/**
 * Token = base64url(JSON payload) "." base64url(HMAC-SHA256(secret, "dl1." + payload)).
 * Stateless: the download Worker needs only the shared secret, not the orders database.
 */
export async function signDownloadToken(
  claims: DownloadClaims,
  expiresAt: number,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!secret) throw new Error('download token secret is not set');
  if (expiresAt - now > MAX_TOKEN_TTL_SECONDS) {
    throw new Error('download tokens may not live longer than 72 hours');
  }
  const payload = base64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        v: 1,
        pay: claims.paymentId,
        prd: claims.productId,
        key: claims.fileKey,
        exp: expiresAt,
      }),
    ),
  );
  return `${payload}.${await hmacBase64url(secret, DOMAIN + payload)}`;
}

export async function verifyDownloadToken(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  const invalid = { ok: false, error: 'invalid' } as const;
  if (!secret) return invalid;
  const parts = token.split('.');
  if (parts.length !== 2) return invalid;
  const [payload = '', sig = ''] = parts;
  if (!payload || !sig) return invalid;
  if (!timingSafeEqual(await hmacBase64url(secret, DOMAIN + payload), sig)) return invalid;

  const bytes = base64urlDecode(payload);
  if (!bytes) return invalid;
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return invalid;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return invalid;
  const b = body as Record<string, unknown>;
  const { v, pay, prd, key, exp } = b;
  if (
    v !== 1 ||
    typeof pay !== 'string' ||
    typeof prd !== 'string' ||
    typeof key !== 'string' ||
    typeof exp !== 'number' ||
    !Number.isInteger(exp)
  ) {
    return invalid;
  }
  if (exp - now > MAX_TOKEN_TTL_SECONDS) return invalid;
  if (now >= exp) return { ok: false, error: 'expired' };
  return { ok: true, claims: { paymentId: pay, productId: prd, fileKey: key, expiresAt: exp } };
}
