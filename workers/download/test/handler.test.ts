import { describe, expect, it } from 'vitest';
import { parseCatalog } from '../../lib/src/catalog.js';
import { signDownloadToken } from '../../lib/src/token.js';
import {
  handleRequest,
  type BucketLike,
  type HandlerConfig,
  type LogEntry,
} from '../src/handler.js';

const NOW_SEC = 1_790_000_000;
const SECRET = 'token-secret';

const catalog = parseCatalog({
  products: [
    {
      id: 'lead-tracker',
      name_en: 'Lead tracker',
      name_hi: 'लीड ट्रैकर',
      price_inr: 199,
      status: 'retired',
      files: [
        {
          key: 'lt/v1/lt.xlsx',
          name: 'changelens-lead-tracker.xlsx',
          content_type: 'application/x-test',
        },
      ],
    },
    {
      id: 'other',
      name_en: 'Other',
      name_hi: 'अन्य',
      price_inr: 299,
      status: 'live',
      files: [{ key: 'other/v1/o.pdf', name: 'o.pdf', content_type: 'application/pdf' }],
    },
  ],
});

function bucket(files: Record<string, string>): BucketLike & { gets: string[] } {
  const gets: string[] = [];
  return {
    gets,
    get(key) {
      gets.push(key);
      const text = files[key];
      if (text === undefined) return Promise.resolve(null);
      const bytes = new TextEncoder().encode(text);
      return Promise.resolve({ body: new Blob([bytes]).stream(), size: bytes.byteLength });
    },
  };
}

function setup(
  files: Record<string, string> = { 'lt/v1/lt.xlsx': 'SHEET', 'other/v1/o.pdf': 'PDF' },
) {
  const logs: LogEntry[] = [];
  const b = bucket(files);
  const cfg: HandlerConfig = {
    bucket: b,
    catalog,
    tokenSecret: SECRET,
    now: () => NOW_SEC,
    log: (e) => logs.push(e),
  };
  return { cfg, bucket: b, logs };
}

const token = (
  over: Partial<{ productId: string; fileKey: string; exp: number; secret: string }> = {},
) =>
  signDownloadToken(
    {
      paymentId: 'pay_DL1',
      productId: over.productId ?? 'lead-tracker',
      fileKey: over.fileKey ?? 'lt/v1/lt.xlsx',
    },
    over.exp ?? NOW_SEC + 3600,
    over.secret ?? SECRET,
    NOW_SEC,
  );

const get = (path: string, method = 'GET') =>
  new Request(`https://dl.example.workers.dev${path}`, { method });

describe('download Worker', () => {
  it('streams the file for a valid token, as an attachment that is never cached', async () => {
    const { cfg, logs } = setup();
    const res = await handleRequest(get(`/d/${await token()}`), cfg);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('SHEET');
    expect(res.headers.get('Content-Type')).toBe('application/x-test');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="changelens-lead-tracker.xlsx"',
    );
    expect(res.headers.get('Content-Length')).toBe('5');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    // Retired products keep working for people who already bought them.
    expect(logs).toEqual([{ evt: 'download', payment_id: 'pay_DL1', product: 'lead-tracker' }]);
  });

  it('answers HEAD without a body', async () => {
    const { cfg } = setup();
    const res = await handleRequest(get(`/d/${await token()}`, 'HEAD'), cfg);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('returns 410 for an expired token and does not touch storage', async () => {
    const { cfg, bucket: b } = setup();
    const t = await token({ exp: NOW_SEC - 1 + 0 });
    const res = await handleRequest(get(`/d/${t}`), { ...cfg, now: () => NOW_SEC + 10 });
    expect(res.status).toBe(410);
    expect(b.gets).toEqual([]);
  });

  it('returns 403 for a tampered or foreign-secret token and does not touch storage', async () => {
    const { cfg, bucket: b } = setup();
    const good = await token();
    const tampered = good.slice(0, -2) + (good.endsWith('AA') ? 'BB' : 'AA');
    for (const t of [tampered, await token({ secret: 'other' }), 'garbage', 'a.b']) {
      expect((await handleRequest(get(`/d/${t}`), cfg)).status).toBe(403);
    }
    expect(b.gets).toEqual([]);
  });

  it('refuses a validly signed token for a file outside its product', async () => {
    const { cfg, bucket: b } = setup();
    for (const t of [
      await token({ fileKey: 'other/v1/o.pdf' }),
      await token({ productId: 'nope' }),
    ]) {
      expect((await handleRequest(get(`/d/${t}`), cfg)).status).toBe(403);
    }
    expect(b.gets).toEqual([]);
  });

  it('returns 404 and logs when the file is missing from storage', async () => {
    const { cfg, logs } = setup({});
    const res = await handleRequest(get(`/d/${await token()}`), cfg);
    expect(res.status).toBe(404);
    expect(logs).toEqual([{ evt: 'file_missing', product: 'lead-tracker', key: 'lt/v1/lt.xlsx' }]);
  });

  it('rejects other methods and paths', async () => {
    const { cfg } = setup();
    expect((await handleRequest(get(`/d/${await token()}`, 'POST'), cfg)).status).toBe(405);
    for (const p of ['/', '/d/', '/d/a/b', '/x/abc']) {
      expect((await handleRequest(get(p), cfg)).status, p).toBe(404);
    }
  });
});
