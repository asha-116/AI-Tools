import { describe, expect, it } from 'vitest';
import { robotsTxt, routesFromPages, sitemapXml } from '../src/lib/sitemap.js';

describe('routesFromPages', () => {
  it('lists English routes once, skips Hindi twins, non-index files and excluded pages', () => {
    const files = [
      './index.astro',
      './hi/index.astro',
      './tools/emi/index.astro',
      './hi/tools/emi/index.astro',
      './get-download/index.astro',
      './tools/emi/Other.astro',
      './sitemap.xml.ts',
    ];
    expect(routesFromPages(files, ['/get-download/'])).toEqual(['/', '/tools/emi/']);
  });
});

describe('sitemapXml', () => {
  it('has one url per language with hreflang alternates, escaped', () => {
    const xml = sitemapXml('https://tools.example.in/', ['/', '/tools/emi/']);
    expect(xml).toContain('<loc>https://tools.example.in/</loc>');
    expect(xml).toContain('<loc>https://tools.example.in/hi/tools/emi/</loc>');
    expect(xml.match(/<url>/g)).toHaveLength(4);
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="hi" href="https://tools.example.in/hi/tools/emi/"/>',
    );
    expect(sitemapXml('https://x.in', ['/a&b/'])).toContain('/a&amp;b/');
    expect(xml.startsWith('<?xml')).toBe(true);
  });
});

describe('robotsTxt', () => {
  it('allows everything and points to the sitemap', () => {
    expect(robotsTxt('https://tools.example.in/')).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://tools.example.in/sitemap.xml\n',
    );
  });
});
