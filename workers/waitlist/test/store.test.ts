import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  d1Store,
  type D1Like,
  type D1PreparedStatementLike,
  type WaitlistStore,
} from '../src/store.js';

/** Runs the real migration and SQL on SQLite (D1 is SQLite) through a D1-shaped adapter. */
function sqliteD1(db: DatabaseSync): D1Like {
  return {
    prepare(sql) {
      let params: unknown[] = [];
      const stmt: D1PreparedStatementLike = {
        bind(...values) {
          params = values;
          return stmt;
        },
        run() {
          db.prepare(sql).run(...(params as never[]));
          return Promise.resolve({ success: true });
        },
        first<T>() {
          const row = db.prepare(sql).get(...(params as never[]));
          return Promise.resolve((row ?? null) as T | null);
        },
      };
      return stmt;
    },
  };
}

const migration = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');

describe('d1Store (against SQLite)', () => {
  let db: DatabaseSync;
  let store: WaitlistStore;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(migration);
    store = d1Store(sqliteD1(db));
  });

  it('counts hits per key', async () => {
    expect(await store.hitRateLimit('k1', 1000)).toBe(1);
    expect(await store.hitRateLimit('k1', 1000)).toBe(2);
    expect(await store.hitRateLimit('k2', 1000)).toBe(1);
  });

  it('ignores duplicate email + idea', async () => {
    const s = {
      email: 'a@x.in',
      idea: 'stamp-duty',
      lang: 'en' as const,
      consentVersion: 'v',
      createdAt: 't',
    };
    await store.addSignup(s);
    await store.addSignup(s);
    await store.addSignup({ ...s, idea: 'lead-tracker' });
    const rows = db.prepare('SELECT idea FROM signups ORDER BY id').all();
    expect(rows.map((r) => r['idea'])).toEqual(['stamp-duty', 'lead-tracker']);
  });

  it('rejects an unknown language at the database level', async () => {
    await expect(
      store.addSignup({
        email: 'a@x.in',
        idea: 'x',
        lang: 'fr' as 'en',
        consentVersion: 'v',
        createdAt: 't',
      }),
    ).rejects.toThrow();
  });

  it('purges old rate-limit windows only', async () => {
    await store.hitRateLimit('old', 100);
    await store.hitRateLimit('new', 5000);
    await store.purgeRateLimits(1000);
    const keys = db
      .prepare('SELECT key FROM rate_limits')
      .all()
      .map((r) => r['key']);
    expect(keys).toEqual(['new']);
  });

  it('falls back to 1 if the database returns no row', async () => {
    const empty: D1Like = {
      prepare: () => {
        const s: D1PreparedStatementLike = {
          bind: () => s,
          run: () => Promise.resolve(null),
          first: () => Promise.resolve(null),
        };
        return s;
      },
    };
    expect(await d1Store(empty).hitRateLimit('k', 1)).toBe(1);
  });
});
