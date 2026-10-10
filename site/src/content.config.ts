// Help articles written by the SEO/Listing agent (agents/seo-listing) and merged by the owner.
// One file per tool and language: site/src/content/articles/<slug>.<en|hi>.md. Merging the
// article PR is the owner's approval to publish (AGENTS.md rule 3); the Verifier has checked it.
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const articles = defineCollection({
  // The id is the file name (eligibility.en / eligibility.hi): Astro would otherwise use the
  // front-matter `slug`, which both languages share, and keep only one of them.
  loader: glob({
    pattern: '*.{en,hi}.md',
    base: './src/content/articles',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    lang: z.enum(['en', 'hi']),
    tool_path: z.string().startsWith('/'),
    last_verified: z.string(),
    generated: z.string(),
  }),
});

export const collections = { articles };
