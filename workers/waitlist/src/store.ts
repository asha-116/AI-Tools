/** Minimal subset of the Cloudflare D1 API used here (keeps us off @cloudflare/workers-types). */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedStatementLike;
}

export interface Signup {
  email: string;
  idea: string;
  lang: 'en' | 'hi';
  consentVersion: string;
  createdAt: string;
}

export interface WaitlistStore {
  /** Increments the counter for `key` in `windowStart` and returns the new count. */
  hitRateLimit(key: string, windowStart: number): Promise<number>;
  /** Stores a sign-up; a repeat of the same email + idea is silently ignored. */
  addSignup(signup: Signup): Promise<void>;
  /** Deletes rate-limit rows older than `before` (epoch seconds). */
  purgeRateLimits(before: number): Promise<void>;
}

export function d1Store(db: D1Like): WaitlistStore {
  return {
    async hitRateLimit(key, windowStart) {
      const row = await db
        .prepare(
          `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
           ON CONFLICT (key) DO UPDATE SET count = count + 1
           RETURNING count`,
        )
        .bind(key, windowStart)
        .first<{ count: number }>();
      return row?.count ?? 1;
    },
    async addSignup(s) {
      await db
        .prepare(
          `INSERT INTO signups (email, idea, lang, consent_version, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (email, idea) DO NOTHING`,
        )
        .bind(s.email, s.idea, s.lang, s.consentVersion, s.createdAt)
        .run();
    },
    async purgeRateLimits(before) {
      await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(before).run();
    },
  };
}
