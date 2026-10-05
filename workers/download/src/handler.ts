import { findFile, type Catalog } from '../../lib/src/catalog.js';
import { verifyDownloadToken } from '../../lib/src/token.js';

/** Minimal subset of the Cloudflare R2 bucket binding used here. */
export interface BucketLike {
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
}

/** Payment and product IDs only — never the token itself (it is a bearer credential). */
export type LogEntry =
  | { evt: 'download'; payment_id: string; product: string }
  | { evt: 'file_missing'; product: string; key: string };

export interface HandlerConfig {
  bucket: BucketLike;
  catalog: Catalog;
  tokenSecret: string;
  /** Current time in epoch seconds. */
  now?: () => number;
  log?: (entry: LogEntry) => void;
}

const PATH_RE = /^\/d\/([A-Za-z0-9_.-]+)$/;

export async function handleRequest(request: Request, cfg: HandlerConfig): Promise<Response> {
  const match = PATH_RE.exec(new URL(request.url).pathname);
  if (!match) return text(404, 'Not found');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return text(405, 'Method not allowed');
  }

  const now = (cfg.now ?? (() => Math.floor(Date.now() / 1000)))();
  const result = await verifyDownloadToken(match[1] ?? '', cfg.tokenSecret, now);
  if (!result.ok) {
    return result.error === 'expired'
      ? text(410, 'This download link has expired. Get a new one on the “Get my download” page.')
      : text(403, 'This download link is not valid.');
  }
  const { claims } = result;
  const file = findFile(cfg.catalog, claims.productId, claims.fileKey);
  if (!file) return text(403, 'This download link is not valid.');

  const object = await cfg.bucket.get(file.key);
  if (!object) {
    cfg.log?.({ evt: 'file_missing', product: claims.productId, key: file.key });
    return text(404, 'File not found. Please contact support with your payment ID.');
  }
  cfg.log?.({ evt: 'download', payment_id: claims.paymentId, product: claims.productId });
  return new Response(request.method === 'HEAD' ? null : object.body, {
    status: 200,
    headers: {
      ...securityHeaders(),
      'Content-Type': file.content_type,
      'Content-Length': String(object.size),
      'Content-Disposition': `attachment; filename="${file.name}"`,
    },
  });
}

function securityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { ...securityHeaders(), 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
