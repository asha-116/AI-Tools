/** WebCrypto helpers shared by the Workers. Runs unchanged in Workers and Node 22. */

const enc = new TextEncoder();

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  return [...(await hmac(secret, message))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacBase64url(secret: string, message: string): Promise<string> {
  return base64urlEncode(await hmac(secret, message));
}

/** Constant-time for equal lengths; the length itself is not secret here (fixed-size MACs). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Razorpay webhooks: `X-Razorpay-Signature` is the hex HMAC-SHA256 of the raw request body,
 * keyed with the webhook secret set in the Razorpay dashboard (not the API key secret).
 */
export async function verifyRazorpaySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!secret || !signature) return false;
  return timingSafeEqual(await hmacHex(secret, rawBody), signature.trim().toLowerCase());
}

const B64URL_RE = /^[A-Za-z0-9_-]*$/;

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(text: string): Uint8Array | null {
  if (!B64URL_RE.test(text) || text.length % 4 === 1) return null;
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
