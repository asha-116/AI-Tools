import { handleRequest, RATE_WINDOW_SECONDS } from './handler.js';
import { d1Store, type D1Like } from './store.js';

export interface Env {
  DB: D1Like;
  ALLOWED_ORIGINS: string;
  IP_HASH_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, {
        store: d1Store(env.DB),
        allowedOrigins: env.ALLOWED_ORIGINS,
        ipHashSecret: env.IP_HASH_SECRET,
      });
    } catch (err) {
      // Log the error type only — the request body contains an email address.
      console.error('waitlist_error', err instanceof Error ? err.name : 'unknown');
      return new Response(JSON.stringify({ ok: false, error: 'server_error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  },

  // Daily cron (wrangler.toml): drop rate-limit rows older than one day.
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    await d1Store(env.DB).purgeRateLimits(nowSec - 24 * RATE_WINDOW_SECONDS);
  },
};
