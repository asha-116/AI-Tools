import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { argValue, cliArgs, slugArg } from '../src/args.js';
import { parseDisclaimers, SHORT_DISCLAIMER } from '../src/disclaimer.js';
import { buildJsonLd, liveProduct, validateJsonLd, type JsonLd } from '../src/jsonld.js';
import { fsRepo, pageExists, readText } from '../src/repo.js';
import { findTool, type ToolInfo } from '../src/tools.js';

const emi = findTool('emi') as ToolInfo;
const faq = [
  { q: 'Q1?', a: 'A1.' },
  { q: 'Q2?', a: 'A2.' },
  { q: 'Q3?', a: 'A3.' },
];

describe('JSON-LD', () => {
  it('builds WebApplication + FAQPage with no price for a free tool', () => {
    const docs = buildJsonLd({ tool: emi, lang: 'hi', name: 'EMI', description: 'd', faq });
    expect(docs[0]).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      url: 'https://tools.changelense.in/hi/tools/emi/',
      inLanguage: 'hi-IN',
      isAccessibleForFree: true,
    });
    expect(docs[0]).not.toHaveProperty('offers');
    expect(docs[1]).toMatchObject({ '@type': 'FAQPage' });
    expect(validateJsonLd(docs, { allowOffer: false })).toEqual([]);
  });

  it('adds an Offer only for a live catalog product', () => {
    const live = { id: 'emi', price_inr: 199, status: 'live' };
    const docs = buildJsonLd({
      tool: emi,
      lang: 'en',
      name: 'n',
      description: 'd',
      faq,
      product: live,
    });
    expect(docs[0]?.offers).toMatchObject({ '@type': 'Offer', price: '199', priceCurrency: 'INR' });
    expect(validateJsonLd(docs, { allowOffer: true })).toEqual([]);
    expect(validateJsonLd(docs, { allowOffer: false })).toEqual([
      'WebApplication: Offer/price is not allowed',
    ]);
  });

  it('liveProduct reads products/catalog.json: nothing is live today', () => {
    const catalog = readFileSync('products/catalog.json', 'utf8');
    expect(liveProduct(catalog, 'lead-tracker')).toBeUndefined();
    expect(liveProduct(null, 'x')).toBeUndefined();
    const live = JSON.stringify({ products: [{ id: 'x', price_inr: 99, status: 'live' }] });
    expect(liveProduct(live, 'x')).toMatchObject({ price_inr: 99 });
    expect(liveProduct('{}', 'x')).toBeUndefined();
  });

  it('reports shape problems', () => {
    const bad: JsonLd[] = [
      {
        '@context': 'http://schema.org',
        '@type': 'WebApplication',
        name: '',
        url: 'https://other.example/',
        description: 'd',
        applicationCategory: 'x',
        nested: [{ '@type': 'AggregateOffer' }],
      },
    ];
    expect(validateJsonLd(bad, { allowOffer: false })).toEqual([
      'missing FAQPage',
      'WebApplication: @context must be schema.org',
      'WebApplication: Offer/price is not allowed',
      'WebApplication: name is required',
      'WebApplication: url must be on our own site',
    ]);
    const faqDoc = (mainEntity: unknown): JsonLd => ({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity,
    });
    expect(validateJsonLd([faqDoc([])], { allowOffer: false })).toEqual([
      'missing WebApplication',
      'FAQPage: mainEntity must have 3–5 questions',
    ]);
    const q = (text: string) => ({
      '@type': 'Question',
      name: 'q',
      acceptedAnswer: { '@type': 'Answer', text },
    });
    expect(
      validateJsonLd([faqDoc([q('a'), q(''), { '@type': 'Thing' }])], { allowOffer: false }),
    ).toEqual([
      'missing WebApplication',
      'FAQPage: answer text is required',
      'FAQPage: each item must be a Question with an Answer',
    ]);
  });
});

describe('disclaimer', () => {
  it('parses the EN and HI paragraphs from the policy file', () => {
    const md = readFileSync('company/policies/disclaimers.md', 'utf8');
    const d = parseDisclaimers(md, '2026-09-29');
    expect(d.en).toContain(SHORT_DISCLAIMER.en);
    expect(d.en).toContain('last verified on 2026-09-29');
    expect(d.hi).toContain(SHORT_DISCLAIMER.hi);
    expect(d.hi).toContain('2026-09-29');
    expect(d.hi).not.toContain('\n');
  });

  it('throws when the policy is missing a language or the rule-7 note', () => {
    expect(() => parseDisclaimers('**EN:** x', 'd')).toThrow('**HI:**');
    expect(() => parseDisclaimers('**EN:** x\n\n**HI:** y', 'd')).toThrow('rule 7');
  });
});

describe('args', () => {
  it('reads --slug in both forms and validates it', () => {
    expect(cliArgs(['node', 'agent.js', 'seo-listing', '--slug', 'emi'])).toEqual([
      '--slug',
      'emi',
    ]);
    expect(slugArg(['--slug', 'emi'])).toBe('emi');
    expect(slugArg(['--slug=stamp-duty'])).toBe('stamp-duty');
    expect(slugArg([])).toBeUndefined();
    expect(argValue(['--slug'], 'slug')).toBeUndefined();
    expect(argValue(['--slug='], 'slug')).toBeUndefined();
    expect(() => slugArg(['--slug', '../etc'])).toThrow('invalid --slug');
  });
});

describe('repo reader', () => {
  const repo = fsRepo(process.cwd());

  it('reads, lists and checks pages', () => {
    expect(repo.read('nope.txt')).toBeNull();
    expect(readText(repo, 'nope.txt')).toBe('');
    expect(repo.read('AGENTS.md')).toContain('AGENTS.md');
    expect(repo.list('site/src/tools')).toEqual([
      'area',
      'carpet-area',
      'commission',
      'eligibility',
      'emi',
      'prepayment',
      'stamp-duty',
    ]);
    expect(repo.list('nope')).toEqual([]);
    expect(pageExists(repo, '/tools/emi/')).toBe(true);
    expect(pageExists(repo, '/hi/tools/emi')).toBe(true);
    expect(pageExists(repo, '/')).toBe(true);
    expect(pageExists(repo, '/tools/nope/')).toBe(false);
    expect(pageExists(repo, 'https://x.example/')).toBe(false);
    expect(pageExists(repo, '//x/')).toBe(false);
  });

  it('refuses paths outside the repo', () => {
    expect(() => repo.read('../x')).toThrow('outside the repo');
    expect(() => repo.exists('/etc/passwd')).toThrow('outside the repo');
  });
});
