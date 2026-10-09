import type { APIRoute } from 'astro';
import { routesFromPages, sitemapXml } from '../lib/sitemap';
import { ALL_STATES } from '../tools/stamp-duty/data';

// Keep this list in step with the pages that set `noindex` on <Base>.
const NOINDEX = ['/get-download/'];
if (!ALL_STATES.some((s) => s.status === 'verified')) NOINDEX.push('/tools/stamp-duty/');

const pages = Object.keys(import.meta.glob('./**/index.astro'));

export const GET: APIRoute = ({ site }) =>
  new Response(sitemapXml(String(site), routesFromPages(pages, NOINDEX)), {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
