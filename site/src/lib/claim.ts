/** Pure logic for the "Get my download" page (validation, response parsing). */

export const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{1,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export type ClaimInputError = 'paymentId' | 'email';

export function validateClaim(
  paymentId: string,
  email: string,
): { ok: true; paymentId: string; email: string } | { ok: false; error: ClaimInputError } {
  const id = paymentId.trim();
  const mail = email.trim().toLowerCase();
  if (!PAYMENT_ID_RE.test(id)) return { ok: false, error: 'paymentId' };
  if (mail.length > 254 || !EMAIL_RE.test(mail)) return { ok: false, error: 'email' };
  return { ok: true, paymentId: id, email: mail };
}

export interface ClaimLink {
  file: string;
  url: string;
}

export type ClaimOutcome =
  | { ok: true; expiresAt: string; links: ClaimLink[] }
  | { ok: false; error: 'notFound' | 'needsSupport' | 'rate' | 'generic' };

/**
 * Turns the claim API response into something the page can show. Links are only accepted
 * from the configured download origin, so a bad response can never inject another URL.
 */
export function parseClaimResponse(
  status: number,
  body: unknown,
  downloadOrigin: string,
): ClaimOutcome {
  if (status === 404) return { ok: false, error: 'notFound' };
  if (status === 409) return { ok: false, error: 'needsSupport' };
  if (status === 429) return { ok: false, error: 'rate' };
  if (status !== 200 || typeof body !== 'object' || body === null) {
    return { ok: false, error: 'generic' };
  }
  const b = body as Record<string, unknown>;
  const links = b['links'];
  const expiresAt = b['expires_at'];
  if (!Array.isArray(links) || links.length === 0 || typeof expiresAt !== 'string') {
    return { ok: false, error: 'generic' };
  }
  const out: ClaimLink[] = [];
  for (const l of links) {
    if (typeof l !== 'object' || l === null) return { ok: false, error: 'generic' };
    const { file, url } = l as Record<string, unknown>;
    if (typeof file !== 'string' || typeof url !== 'string') return { ok: false, error: 'generic' };
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: 'generic' };
    }
    if (parsed.origin !== downloadOrigin || !parsed.pathname.startsWith('/d/')) {
      return { ok: false, error: 'generic' };
    }
    out.push({ file, url: parsed.href });
  }
  return { ok: true, expiresAt, links: out };
}

/** "5 Oct 2026, 3:30 pm" in the buyer's language and time zone. */
export function formatExpiry(iso: string, lang: 'en' | 'hi'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
