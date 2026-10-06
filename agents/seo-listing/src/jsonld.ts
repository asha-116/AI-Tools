// schema.org JSON-LD built by code from validated text (never by a model), plus a validator.
// No Offer/price unless the product is `live` in products/catalog.json (AGENTS.md rule 3/4).

import { SITE_ORIGIN } from './policy.js';
import type { Lang, ToolInfo } from './tools.js';

export interface Faq {
  q: string;
  a: string;
}

export interface CatalogProduct {
  id: string;
  price_inr: number;
  status: string;
}

export type JsonLd = Record<string, unknown>;

/** The catalog entry for `slug` only when it is live (buyable); otherwise undefined. */
export function liveProduct(catalogJson: string | null, slug: string): CatalogProduct | undefined {
  if (!catalogJson) return undefined;
  const parsed = JSON.parse(catalogJson) as { products?: CatalogProduct[] };
  const p = parsed.products?.find((x) => x.id === slug);
  return p && p.status === 'live' && Number.isFinite(p.price_inr) ? p : undefined;
}

export function buildJsonLd(input: {
  tool: ToolInfo;
  lang: Lang;
  name: string;
  description: string;
  faq: Faq[];
  product?: CatalogProduct | undefined;
}): JsonLd[] {
  const url = `${SITE_ORIGIN}${input.tool.path(input.lang)}`;
  const app: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: input.name,
    description: input.description,
    url,
    inLanguage: input.lang === 'en' ? 'en-IN' : 'hi-IN',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Any',
    isAccessibleForFree: input.product === undefined,
  };
  if (input.product) {
    app.offers = {
      '@type': 'Offer',
      price: String(input.product.price_inr),
      priceCurrency: 'INR',
      availability: 'https://schema.org/InStock',
    };
  }
  const faqPage: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: app.inLanguage,
    mainEntity: input.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  return [app, faqPage];
}

function hasPrice(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPrice);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([k, v]) =>
        ['offers', 'price', 'priceCurrency', 'lowPrice', 'highPrice'].includes(k) ||
        (k === '@type' && (v === 'Offer' || v === 'AggregateOffer')) ||
        hasPrice(v),
    );
  }
  return false;
}

const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/** Shape check for what we publish. Returns problems; empty = valid. */
export function validateJsonLd(docs: JsonLd[], opts: { allowOffer: boolean }): string[] {
  const errors: string[] = [];
  const types = docs.map((d) => d['@type']);
  if (!types.includes('WebApplication')) errors.push('missing WebApplication');
  if (!types.includes('FAQPage')) errors.push('missing FAQPage');
  for (const d of docs) {
    const t = String(d['@type']);
    if (d['@context'] !== 'https://schema.org') errors.push(`${t}: @context must be schema.org`);
    if (!opts.allowOffer && hasPrice(d)) errors.push(`${t}: Offer/price is not allowed`);
    if (t === 'WebApplication') {
      for (const k of ['name', 'description', 'url', 'applicationCategory']) {
        if (!nonEmpty(d[k])) errors.push(`WebApplication: ${k} is required`);
      }
      if (typeof d.url === 'string' && !d.url.startsWith(`${SITE_ORIGIN}/`)) {
        errors.push('WebApplication: url must be on our own site');
      }
    }
    if (t === 'FAQPage') {
      const items = d.mainEntity;
      if (!Array.isArray(items) || items.length < 3 || items.length > 5) {
        errors.push('FAQPage: mainEntity must have 3–5 questions');
      } else {
        for (const q of items as JsonLd[]) {
          const ans = q.acceptedAnswer as JsonLd | undefined;
          if (q['@type'] !== 'Question' || !nonEmpty(q.name) || ans?.['@type'] !== 'Answer') {
            errors.push('FAQPage: each item must be a Question with an Answer');
          } else if (!nonEmpty(ans.text)) {
            errors.push('FAQPage: answer text is required');
          }
        }
      }
    }
  }
  return errors;
}
