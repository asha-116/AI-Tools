import { describe, expect, it } from 'vitest';
import {
  CONSENT_VERSION,
  RATE_LIMIT_PER_WINDOW,
  handleRequest,
  validate,
  type HandlerConfig,
} from '../src/handler.js';
import type { Signup, WaitlistStore } from '../src/store.js';

const ORIGIN = 'https://tools.changelense.in';

function memoryStore(): WaitlistStore & { signups: Signup[]; counts: Map<string, number> } {
  const signups: Signup[] = [];
  const counts = new Map<string, number>();
  return {
    signups,
    counts,
    hitRateLimit(key) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return Promise.resolve(n);
    },
    addSignup(s) {
      if (!signups.some((x) => x.email === s.email && x.idea === s.idea)) signups.push(s);
      return Promise.resolve();
    },
    purgeRateLimits() {
      return Promise.resolve();
    },
  };
}

function config(store = memoryStore()): HandlerConfig & { store: ReturnType<typeof memoryStore> } {
  return {
    store,
    allowedOrigins: `${ORIGIN}, http://localhost:4321`,
    ipHashSecret: 'test-secret',
    now: () => new Date('2026-09-29T10:15:00Z'),
  };
}

function post(
  body: unknown,
  init: { origin?: string | null; ip?: string; contentType?: string } = {},
) {
  const headers = new Headers({ 'Content-Type': init.contentType ?? 'application/json' });
  if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
  headers.set('CF-Connecting-IP', init.ip ?? '203.0.113.7');
  return new Request('https://waitlist.example.workers.dev/api/waitlist', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const good = {
  email: 'Agent@Example.com ',
  idea: 'stamp-duty',
  lang: 'en',
  consent: true,
  website: '',
};

describe('handleRequest', () => {
  it('stores a valid sign-up, normalising the email, and returns CORS headers', async () => {
    const cfg = config();
    const res = await handleRequest(post(good), cfg);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(cfg.store.signups).toEqual([
      {
        email: 'agent@example.com',
        idea: 'stamp-duty',
        lang: 'en',
        consentVersion: CONSENT_VERSION,
        createdAt: '2026-09-29T10:15:00.000Z',
      },
    ]);
  });

  it('is idempotent for the same email + idea and gives the same response', async () => {
    const cfg = config();
    const a = await handleRequest(post(good), cfg);
    const b = await handleRequest(post(good), cfg);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(cfg.store.signups).toHaveLength(1);
  });

  it('accepts the same email for a different idea', async () => {
    const cfg = config();
    await handleRequest(post(good), cfg);
    await handleRequest(post({ ...good, idea: 'lead-tracker', lang: 'hi' }), cfg);
    expect(cfg.store.signups.map((s) => s.idea)).toEqual(['stamp-duty', 'lead-tracker']);
  });

  it('silently drops honeypot submissions', async () => {
    const cfg = config();
    const res = await handleRequest(post({ ...good, website: 'http://spam.example' }), cfg);
    expect(res.status).toBe(200);
    expect(cfg.store.signups).toHaveLength(0);
  });

  it('rate-limits per client IP and window', async () => {
    const cfg = config();
    for (let i = 0; i < RATE_LIMIT_PER_WINDOW; i++) {
      expect(
        (await handleRequest(post({ ...good, email: `a${String(i)}@x.in` }), cfg)).status,
      ).toBe(200);
    }
    expect((await handleRequest(post(good), cfg)).status).toBe(429);
    expect((await handleRequest(post(good, { ip: '198.51.100.1' }), cfg)).status).toBe(200);
  });

  it('never uses the raw IP as the rate-limit key', async () => {
    const cfg = config();
    await handleRequest(post(good), cfg);
    const [key] = [...cfg.store.counts.keys()];
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('203.0.113.7');
  });

  it('rejects disallowed or missing origins', async () => {
    const cfg = config();
    expect((await handleRequest(post(good, { origin: 'https://evil.example' }), cfg)).status).toBe(
      403,
    );
    expect((await handleRequest(post(good, { origin: null }), cfg)).status).toBe(403);
    expect(cfg.store.signups).toHaveLength(0);
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const cfg = config();
    const pre = (origin: string) =>
      new Request('https://w.example/api/waitlist', {
        method: 'OPTIONS',
        headers: { Origin: origin },
      });
    const ok = await handleRequest(pre(ORIGIN), cfg);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect((await handleRequest(pre('https://evil.example'), cfg)).status).toBe(403);
  });

  it('returns 404 for other paths and 405 for other methods', async () => {
    const cfg = config();
    expect((await handleRequest(new Request('https://w.example/'), cfg)).status).toBe(404);
    const get = new Request('https://w.example/api/waitlist', { headers: { Origin: ORIGIN } });
    expect((await handleRequest(get, cfg)).status).toBe(405);
  });

  it('rejects non-JSON, malformed and oversized bodies', async () => {
    const cfg = config();
    expect((await handleRequest(post(good, { contentType: 'text/plain' }), cfg)).status).toBe(415);
    expect((await handleRequest(post('{not json'), cfg)).status).toBe(400);
    const big = await handleRequest(post({ ...good, website: 'x'.repeat(3000) }), cfg);
    expect(big.status).toBe(413);
  });

  it('returns a validation error code for bad fields', async () => {
    const res = await handleRequest(post({ ...good, idea: 'crypto-bot' }), config());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_idea' });
  });

  it('uses the real clock when none is injected', async () => {
    const cfg = config();
    delete cfg.now;
    await handleRequest(post(good, { ip: '192.0.2.9' }), cfg);
    expect(cfg.store.signups[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('validate', () => {
  it.each([
    [null, 'invalid_body'],
    [[], 'invalid_body'],
    ['str', 'invalid_body'],
    [{ ...good, email: 42 }, 'invalid_email'],
    [{ ...good, email: '' }, 'invalid_email'],
    [{ ...good, email: 'no-at-sign' }, 'invalid_email'],
    [{ ...good, email: 'a@b' }, 'invalid_email'],
    [{ ...good, email: 'a b@c.in' }, 'invalid_email'],
    [{ ...good, email: `${'a'.repeat(250)}@x.in` }, 'invalid_email'],
    [{ ...good, idea: 3 }, 'invalid_idea'],
    [{ ...good, lang: 'fr' }, 'invalid_lang'],
    [{ ...good, consent: 'yes' }, 'consent_required'],
    [{ ...good, consent: undefined }, 'consent_required'],
  ])('%j → %s', (body, error) => {
    expect(validate(body)).toEqual({ error });
  });

  it('treats a whitespace-only honeypot as human', () => {
    expect(validate({ ...good, website: '   ' })).toMatchObject({ bot: false });
    expect(validate({ ...good, website: undefined })).toMatchObject({ bot: false });
  });
});
