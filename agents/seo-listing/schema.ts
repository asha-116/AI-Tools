// zod schema of the SEO/Listing model output (mirrors PROCEDURE.md "Output schema").
// The model writes text only. Numbers, JSON-LD, links and the disclaimer are added by code;
// content rules (banned words, invented numbers, word counts) are checked in src/article.ts.

import { z } from 'zod';

const Meta = z.object({
  title: z.string().trim().min(10).max(60),
  description: z.string().trim().min(50).max(155),
});

const FaqItem = z.object({
  q: z.string().trim().min(5).max(200),
  a: z.string().trim().min(10).max(600),
});

const Faq = z.array(FaqItem).min(3).max(5);

/** Prose sections of one help article (markdown, no headings — code adds those). */
const ArticleSections = z.object({
  intro: z.string().trim().min(50),
  how_to_use: z.string().trim().min(50),
  formula_explained: z.string().trim().min(50),
  when_to_use: z.string().trim().min(50),
});

export const SeoDraftSchema = z.object({
  meta: z.object({ en: Meta, hi: Meta }),
  faq: z.object({ en: Faq, hi: Faq }),
  articles: z.object({ en: ArticleSections, hi: ArticleSections }),
});

export type SeoDraft = z.infer<typeof SeoDraftSchema>;
export type ArticleDraft = z.infer<typeof ArticleSections>;

/** The validated listing the agent commits (PROCEDURE.md output schema). */
export interface SeoListing {
  slug: string;
  meta: SeoDraft['meta'];
  faq: SeoDraft['faq'];
  jsonld: { en: Record<string, unknown>[]; hi: Record<string, unknown>[] };
  articles: { en: string; hi: string };
  producer_family: string;
}
