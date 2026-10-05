import catalogFile from '../../../products/catalog.json' with { type: 'json' };
import { parseCatalog } from '../../lib/src/catalog.js';
import { handleRequest, RATE_WINDOW_SECONDS } from './handler.js';
import { d1Store, type D1Like } from './store.js';

export interface Env {
  DB: D1Like;
  ALLOWED_ORIGINS: string;
  DOWNLOAD_BASE_URL: string;
  /** "true" only while Razorpay is in test mode. */
  ALLOW_DRAFT_PRODUCTS?: string;
  RAZORPAY_WEBHOOK_SECRET: string;
  HASH_SECRET: string;
  DOWNLOAD_TOKEN_SECRET: string;
}

// Validated once per isolate; a bad catalog fails every request loudly instead of selling wrongly.
const catalog = parseCatalog(catalogFile);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, {
        store: d1Store(env.DB),
        catalog,
        webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
        hashSecret: env.HASH_SECRET,
        tokenSecret: env.DOWNLOAD_TOKEN_SECRET,
        downloadBaseUrl: env.DOWNLOAD_BASE_URL,
        allowedOrigins: env.ALLOWED_ORIGINS,
        allowDrafts: env.ALLOW_DRAFT_PRODUCTS === 'true',
        log: (entry) => {
          console.log(JSON.stringify(entry));
        },
      });
    } catch (err) {
      // Log the error type only — request bodies contain email addresses.
      console.error('payment_error', err instanceof Error ? err.name : 'unknown');
      // 500 makes Razorpay retry the webhook later, which is what we want on a transient failure.
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
