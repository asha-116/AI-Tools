import ideasFile from '../../../data/waitlist-ideas.json' with { type: 'json' };
import type { WaitlistStore } from './store.js';

/** Bump when the consent wording on the form changes; stored with every sign-up. */
export const CONSENT_VERSION = '2026-09-29-draft';
export const RATE_LIMIT_PER_WINDOW = 5;
export const RATE_WINDOW_SECONDS = 3600;
const MAX_BODY_BYTES = 2048;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const IDEA_IDS: ReadonlySet<string> = new Set(ideasFile.ideas.map((i) => i.id));

export interface HandlerConfig {
  store: WaitlistStore;
  /** Comma-separated list of origins allowed to call the API, e.g. https://tools.changelense.in */
  allowedOrigins: string;
  /** Secret used to HMAC client IPs for rate limiting. */
  ipHashSecret: string;
  now?: () => Date;
}

type Json = Record<string, unknown>;

export async function handleRequest(request: Request, cfg: HandlerConfig): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = parseOrigins(cfg.allowedOrigins);
  const cors = origin !== null && allowed.has(origin) ? corsHeaders(origin) : null;

  if (url.pathname !== '/api/waitlist') return json(404, { ok: false, error: 'not_found' }, cors);

  if (request.method === 'OPTIONS') {
    return cors
      ? new Response(null, { status: 204, headers: cors })
      : new Response(null, { status: 403 });
  }
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, cors);
  if (!cors) return json(403, { ok: false, error: 'origin_not_allowed' }, null);

  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/json')) {
    return json(415, { ok: false, error: 'unsupported_media_type' }, cors);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: 'too_large' }, cors);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'invalid_json' }, cors);
  }

  const parsed = validate(body);
  if ('error' in parsed) return json(400, { ok: false, error: parsed.error }, cors);

  const now = (cfg.now ?? (() => new Date()))();
  const nowSec = Math.floor(now.getTime() / 1000);
  const windowStart = nowSec - (nowSec % RATE_WINDOW_SECONDS);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const key = await hmacHex(cfg.ipHashSecret, `${ip}|${String(windowStart)}`);
  const count = await cfg.store.hitRateLimit(key, windowStart);
  if (count > RATE_LIMIT_PER_WINDOW) return json(429, { ok: false, error: 'rate_limited' }, cors);

  // Honeypot filled in: pretend success so bots learn nothing, store nothing.
  if (parsed.bot) return json(200, { ok: true }, cors);

  await cfg.store.addSignup({
    email: parsed.email,
    idea: parsed.idea,
    lang: parsed.lang,
    consentVersion: CONSENT_VERSION,
    createdAt: now.toISOString(),
  });
  // Same response whether or not the email was already on the list (no enumeration).
  return json(200, { ok: true }, cors);
}

type Valid = { email: string; idea: string; lang: 'en' | 'hi'; bot: boolean };

export function validate(body: unknown): Valid | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return { error: 'invalid_body' };
  const b = body as Json;
  const email = typeof b['email'] === 'string' ? b['email'].trim().toLowerCase() : '';
  if (email.length === 0 || email.length > 254 || !EMAIL_RE.test(email))
    return { error: 'invalid_email' };
  const idea = b['idea'];
  if (typeof idea !== 'string' || !IDEA_IDS.has(idea)) return { error: 'invalid_idea' };
  const lang = b['lang'];
  if (lang !== 'en' && lang !== 'hi') return { error: 'invalid_lang' };
  if (b['consent'] !== true) return { error: 'consent_required' };
  const honeypot = b['website'];
  const bot = typeof honeypot === 'string' && honeypot.trim().length > 0;
  return { email, idea, lang, bot };
}

function parseOrigins(list: string): Set<string> {
  return new Set(
    list
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(status: number, data: Json, cors: Record<string, string> | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(cors ?? {}),
    },
  });
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
