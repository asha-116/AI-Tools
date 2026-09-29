import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index.js';
import type { D1Like, D1PreparedStatementLike } from '../src/store.js';

function recordingDb(fail = false): D1Like & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    prepare(q) {
      sql.push(q);
      const s: D1PreparedStatementLike = {
        bind: () => s,
        run: () => (fail ? Promise.reject(new Error('db down: a@x.in')) : Promise.resolve(null)),
        first: <T>() =>
          fail ? Promise.reject(new Error('db down')) : Promise.resolve({ count: 1 } as T),
      };
      return s;
    },
  };
}

const req = () =>
  new Request('https://w.example/api/waitlist', {
    method: 'POST',
    headers: { Origin: 'https://site.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@x.in', idea: 'stamp-duty', lang: 'hi', consent: true }),
  });

describe('worker entry', () => {
  it('wires env into the handler', async () => {
    const env: Env = {
      DB: recordingDb(),
      ALLOWED_ORIGINS: 'https://site.example',
      IP_HASH_SECRET: 's',
    };
    const res = await worker.fetch(req(), env);
    expect(res.status).toBe(200);
  });

  it('returns 500 without logging request data when the database fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env: Env = {
      DB: recordingDb(true),
      ALLOWED_ORIGINS: 'https://site.example',
      IP_HASH_SECRET: 's',
    };
    const res = await worker.fetch(req(), env);
    expect(res.status).toBe(500);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('a@x.in');
    spy.mockRestore();
  });

  it('logs "unknown" for non-Error throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db: D1Like = {
      prepare: () => {
        throw 'boom';
      },
    };
    const res = await worker.fetch(req(), {
      DB: db,
      ALLOWED_ORIGINS: 'https://site.example',
      IP_HASH_SECRET: 's',
    });
    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalledWith('waitlist_error', 'unknown');
    spy.mockRestore();
  });

  it('scheduled purges old rate-limit rows', async () => {
    const db = recordingDb();
    await worker.scheduled({}, { DB: db, ALLOWED_ORIGINS: '', IP_HASH_SECRET: 's' });
    expect(db.sql[0]).toContain('DELETE FROM rate_limits');
  });
});
