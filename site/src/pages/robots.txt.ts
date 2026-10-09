import type { APIRoute } from 'astro';
import { robotsTxt } from '../lib/sitemap';

export const GET: APIRoute = ({ site }) =>
  new Response(robotsTxt(String(site)), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
