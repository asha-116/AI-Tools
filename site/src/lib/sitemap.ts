/** sitemap.xml and robots.txt for search engines. Pure — unit-tested. */

/**
 * Routes (English paths; each also exists under /hi/) from page file names such as
 * `./tools/emi/index.astro`. `/hi/` pages are the Hindi twins; `exclude` lists routes kept out
 * of search (noindex pages).
 */
export function routesFromPages(files: readonly string[], exclude: readonly string[]): string[] {
  const routes = new Set<string>();
  for (const f of files) {
    const m = /^\.\/(.*?)index\.astro$/.exec(f);
    if (!m || m[1]?.startsWith('hi/')) continue;
    const route = `/${m[1] ?? ''}`;
    if (!exclude.includes(route)) routes.add(route);
  }
  return [...routes].sort();
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One <url> per language, each listing both languages as alternates (hreflang). */
export function sitemapXml(site: string, routes: readonly string[]): string {
  const base = site.replace(/\/+$/, '');
  const urls: string[] = [];
  for (const route of routes) {
    const en = `${base}${route}`;
    const hi = `${base}/hi${route}`;
    const alternates = [
      `<xhtml:link rel="alternate" hreflang="en" href="${esc(en)}"/>`,
      `<xhtml:link rel="alternate" hreflang="hi" href="${esc(hi)}"/>`,
      `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(en)}"/>`,
    ].join('');
    for (const loc of [en, hi]) urls.push(`<url><loc>${esc(loc)}</loc>${alternates}</url>`);
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

export function robotsTxt(site: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${site.replace(/\/+$/, '')}/sitemap.xml\n`;
}
