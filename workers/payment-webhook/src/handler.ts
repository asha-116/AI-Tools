import { resolveProduct, type Catalog } from '../../lib/src/catalog.js';
import { hmacHex, timingSafeEqual, verifyRazorpaySignature } from '../../lib/src/crypto.js';
import { MAX_TOKEN_TTL_SECONDS, signDownloadToken } from '../../lib/src/token.js';
import type { OrdersStore } from './store.js';

export const CLAIM_RATE_LIMIT = 10;
export const RATE_WINDOW_SECONDS = 3600;
const MAX_WEBHOOK_BYTES = 64 * 1024;
const MAX_CLAIM_BYTES = 1024;
const HANDLED_EVENTS: ReadonlySet<string> = new Set(['payment.captured', 'order.paid']);
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{1,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Structured log line. Payment IDs and product IDs only — never an email or phone number. */
export type LogEntry =
  | { evt: 'payment_recorded' | 'payment_duplicate'; payment_id: string; product: string | null }
  | { evt: 'payment_unmatched'; payment_id: string; amount_paise: number }
  | { evt: 'webhook_rejected'; reason: string }
  | { evt: 'claim_issued'; payment_id: string; product: string };

export interface HandlerConfig {
  store: OrdersStore;
  catalog: Catalog;
  /** Secret entered when creating the webhook in the Razorpay dashboard. */
  webhookSecret: string;
  /** HMAC key for email and IP hashes. */
  hashSecret: string;
  /** Shared with the download Worker. */
  tokenSecret: string;
  /** Base URL of the download Worker, e.g. https://toolshop-download.<sub>.workers.dev */
  downloadBaseUrl: string;
  /** Comma-separated origins allowed to call /api/claim. */
  allowedOrigins: string;
  /** true only in Razorpay test mode: lets draft products be bought. */
  allowDrafts: boolean;
  now?: () => Date;
  log?: (entry: LogEntry) => void;
}

type Json = Record<string, unknown>;
type Cors = Record<string, string> | null;

export async function handleRequest(request: Request, cfg: HandlerConfig): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/razorpay/webhook') return webhook(request, cfg);
  if (pathname === '/api/claim') return claim(request, cfg);
  return json(404, { ok: false, error: 'not_found' }, null);
}

async function webhook(request: Request, cfg: HandlerConfig): Promise<Response> {
  const log = cfg.log ?? (() => undefined);
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, null);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_WEBHOOK_BYTES) {
    log({ evt: 'webhook_rejected', reason: 'too_large' });
    return json(413, { ok: false, error: 'too_large' }, null);
  }
  // Verify before parsing: the signature covers the exact raw bytes.
  const sig = request.headers.get('X-Razorpay-Signature');
  if (!(await verifyRazorpaySignature(raw, sig, cfg.webhookSecret))) {
    log({ evt: 'webhook_rejected', reason: 'bad_signature' });
    return json(401, { ok: false, error: 'bad_signature' }, null);
  }

  const parsed = parsePaymentEvent(raw);
  if ('ignored' in parsed) return json(200, { ok: true, ignored: true }, null);
  if ('error' in parsed) {
    log({ evt: 'webhook_rejected', reason: parsed.error });
    return json(400, { ok: false, error: parsed.error }, null);
  }

  const product = resolveProduct(
    cfg.catalog,
    { amountPaise: parsed.amountPaise, notes: parsed.notes },
    cfg.allowDrafts,
  );
  const now = (cfg.now ?? (() => new Date()))();
  const inserted = await cfg.store.recordPayment({
    paymentId: parsed.paymentId,
    productId: product?.id ?? null,
    amountPaise: parsed.amountPaise,
    emailHash: parsed.email ? await emailHash(cfg.hashSecret, parsed.email) : null,
    eventId: request.headers.get('X-Razorpay-Event-Id'),
    createdAt: now.toISOString(),
  });
  if (!inserted) {
    log({ evt: 'payment_duplicate', payment_id: parsed.paymentId, product: product?.id ?? null });
  } else if (product) {
    log({ evt: 'payment_recorded', payment_id: parsed.paymentId, product: product.id });
  } else {
    log({
      evt: 'payment_unmatched',
      payment_id: parsed.paymentId,
      amount_paise: parsed.amountPaise,
    });
  }
  // Always 200 for a valid, signed event so Razorpay does not retry it.
  return json(200, { ok: true }, null);
}

type ParsedPayment = {
  paymentId: string;
  amountPaise: number;
  email: string | null;
  notes: unknown;
};

function parsePaymentEvent(raw: string): ParsedPayment | { ignored: true } | { error: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: 'invalid_json' };
  }
  if (!isObj(body)) return { error: 'invalid_body' };
  if (typeof body['event'] !== 'string' || !HANDLED_EVENTS.has(body['event'])) {
    return { ignored: true };
  }
  const payload = body['payload'];
  const payment = isObj(payload) && isObj(payload['payment']) ? payload['payment'] : null;
  const p = payment && isObj(payment['entity']) ? payment['entity'] : null;
  if (!p) return { error: 'no_payment' };
  const { id, amount, currency, status, email, notes } = p;
  if (typeof id !== 'string' || !PAYMENT_ID_RE.test(id)) return { error: 'bad_payment_id' };
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return { error: 'bad_amount' };
  }
  if (currency !== 'INR') return { error: 'bad_currency' };
  if (status !== 'captured') return { error: 'not_captured' };
  return {
    paymentId: id,
    amountPaise: amount,
    email: typeof email === 'string' && email.trim() ? normaliseEmail(email) : null,
    notes,
  };
}

async function claim(request: Request, cfg: HandlerConfig): Promise<Response> {
  const origin = request.headers.get('Origin');
  const cors =
    origin !== null && parseOrigins(cfg.allowedOrigins).has(origin) ? corsHeaders(origin) : null;
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
  if (new TextEncoder().encode(raw).byteLength > MAX_CLAIM_BYTES) {
    return json(413, { ok: false, error: 'too_large' }, cors);
  }

  const now = (cfg.now ?? (() => new Date()))();
  const nowSec = Math.floor(now.getTime() / 1000);
  const windowStart = nowSec - (nowSec % RATE_WINDOW_SECONDS);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const key = await hmacHex(cfg.hashSecret, `ip|${ip}|${String(windowStart)}`);
  if ((await cfg.store.hitRateLimit(key, windowStart)) > CLAIM_RATE_LIMIT) {
    return json(429, { ok: false, error: 'rate_limited' }, cors);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'invalid_json' }, cors);
  }
  if (!isObj(body)) return json(400, { ok: false, error: 'invalid_body' }, cors);
  const paymentId = typeof body['payment_id'] === 'string' ? body['payment_id'].trim() : '';
  const email = typeof body['email'] === 'string' ? normaliseEmail(body['email']) : '';
  if (!PAYMENT_ID_RE.test(paymentId))
    return json(400, { ok: false, error: 'invalid_payment_id' }, cors);
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return json(400, { ok: false, error: 'invalid_email' }, cors);
  }

  const order = await cfg.store.findOrder(paymentId);
  const hash = await emailHash(cfg.hashSecret, email);
  // Same answer for "no such payment" and "wrong email": nothing to enumerate.
  if (!order?.emailHash || !timingSafeEqual(order.emailHash, hash)) {
    return json(404, { ok: false, error: 'not_found' }, cors);
  }
  const product = cfg.catalog.products.find((p) => p.id === order.productId);
  if (!product) return json(409, { ok: false, error: 'needs_support' }, cors);

  const expiresAt = nowSec + MAX_TOKEN_TTL_SECONDS;
  const base = cfg.downloadBaseUrl.replace(/\/+$/, '');
  const links = [];
  for (const f of product.files) {
    const token = await signDownloadToken(
      { paymentId, productId: product.id, fileKey: f.key },
      expiresAt,
      cfg.tokenSecret,
      nowSec,
    );
    links.push({ file: f.name, url: `${base}/d/${token}` });
  }
  cfg.log?.({ evt: 'claim_issued', payment_id: paymentId, product: product.id });
  return json(
    200,
    {
      ok: true,
      product: product.id,
      expires_at: new Date(expiresAt * 1000).toISOString(),
      links,
    },
    cors,
  );
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emailHash(secret: string, email: string): Promise<string> {
  return hmacHex(secret, `email|${email}`);
}

function isObj(x: unknown): x is Json {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
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

function json(status: number, data: Json, cors: Cors): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(cors ?? {}),
    },
  });
}
