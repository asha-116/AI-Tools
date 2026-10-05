import catalogFile from '../../../products/catalog.json' with { type: 'json' };
import { parseCatalog } from '../../lib/src/catalog.js';
import { handleRequest, type BucketLike } from './handler.js';

export interface Env {
  FILES: BucketLike;
  DOWNLOAD_TOKEN_SECRET: string;
}

const catalog = parseCatalog(catalogFile);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, {
        bucket: env.FILES,
        catalog,
        tokenSecret: env.DOWNLOAD_TOKEN_SECRET,
        log: (entry) => {
          console.log(JSON.stringify(entry));
        },
      });
    } catch (err) {
      // Never log the URL: the token in it is a bearer credential.
      console.error('download_error', err instanceof Error ? err.name : 'unknown');
      return new Response('Something went wrong. Please try again in a minute.', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  },
};
