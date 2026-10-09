import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { guideRoutes, routesFromPages, sitemapXml } from '../lib/sitemap';
import { ALL_STATES } from '../tools/stamp-duty/data';

// Keep this list in step with the pages that set `noindex` on <Base>.
const NOINDEX = ['/get-download/'];
if (!ALL_STATES.some((s) => s.status === 'verified')) NOINDEX.push('/tools/stamp-duty/');

const pages = Object.keys(import.meta.glob('./**/index.astro'));

export const GET: APIRoute = async ({ site }) => {
  // Guides (site/src/content/articles) are listed when both languages exist, like every page.
  const articles = (await getCollection('articles')).map((a) => a.data);
  const guides = guideRoutes(articles);
  const routes = [...routesFromPages(pages, NOINDEX), ...guides].sort();
  return new Response(sitemapXml(String(site), routes), {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
