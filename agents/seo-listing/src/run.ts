// SEO/Listing pipeline (agents/seo-listing/PROCEDURE.md): for one merged tool, draft meta, FAQ
// and EN + HI help articles; numbers come from tools-core, JSON-LD and the disclaimer from code;
// validate everything; open PR agent/seo-listing/<slug>. Dry-run by default.

import {
  chatJson,
  Escalation,
  LlmUnavailable,
  promptSections,
  renderTemplate,
  runAgent,
  type AgentContext,
  type RunOptions,
} from '../../lib/src/index.js';
import { SeoDraftSchema, type SeoDraft, type SeoListing } from '../schema.js';
import { cliArgs, slugArg } from './args.js';
import { articleBody, draftProblems, renderArticle, WORDS, type ArticleContext } from './article.js';
import { parseDisclaimers } from './disclaimer.js';
import { buildJsonLd, liveProduct, validateJsonLd } from './jsonld.js';
import { wordCount } from './policy.js';
import { fsRepo, pageExists, type RepoReader } from './repo.js';
import { findTool, LANGS, placeholderList, TOOLS, type WorkedExample } from './tools.js';

export const AGENT = 'seo-listing';
export const ARTICLES_DIR = 'site/src/content/articles';

export interface SeoOptions {
  slug: string | undefined;
  repo?: RepoReader;
}

export type SeoResult =
  | { status: 'skipped'; reason: string; example?: WorkedExample }
  | { status: 'drafted'; pr: number; files: string[]; family: string; listing: SeoListing };

export function articlePaths(slug: string) {
  return {
    en: `${ARTICLES_DIR}/${slug}.en.md`,
    hi: `${ARTICLES_DIR}/${slug}.hi.md`,
    seo: `${ARTICLES_DIR}/${slug}.seo.json`,
  };
}

const EMPTY_DRAFT: SeoDraft = {
  meta: { en: { title: '', description: '' }, hi: { title: '', description: '' } },
  faq: { en: [], hi: [] },
  articles: {
    en: { intro: '', how_to_use: '', formula_explained: '', when_to_use: '' },
    hi: { intro: '', how_to_use: '', formula_explained: '', when_to_use: '' },
  },
};

/** Words the model should write so the assembled article lands mid-range. */
export function targetWords(actx: ArticleContext): number {
  const fixed = wordCount(articleBody(renderArticle(EMPTY_DRAFT, 'en', actx, '')));
  const faq = 180;
  return Math.max(300, Math.round((WORDS.min + WORDS.max) / 2 - fixed - faq));
}

function prBody(listing: SeoListing, slug: string, files: string[], dryNote: string): string {
  return [
    `Listing copy and help articles for the **${slug}** tool, drafted by the SEO/Listing agent.`,
    '',
    `Producer model family: \`${listing.producer_family}\``,
    '<!-- producer-family: ' + listing.producer_family + ' -->',
    '',
    '**Verifier required** (published text): use a different model family from the producer.',
    '',
    'Files:',
    ...files.map((f) => `- \`${f}\``),
    '',
    'Checked by code before this PR:',
    '- [x] Titles ≤ 60 chars, descriptions ≤ 155 chars, 3–5 FAQs per language',
    `- [x] Articles ${WORDS.min}–${WORDS.max} words; worked-example numbers computed by tools-core`,
    '- [x] No "guaranteed" / "best" / "official", no income promises, no competitor names',
    '- [x] JSON-LD: WebApplication + FAQPage, no Offer/price (product not live)',
    '- [x] Internal links resolve to pages; disclaimer from company/policies/disclaimers.md',
    '',
    'Needs a human:',
    '- [ ] Hindi reviewed by a fluent speaker (money terms — AGENTS.md "Bilingual")',
    '- [ ] Owner: wire these files into the site (no Astro content collection is configured yet)',
    '',
    dryNote,
  ].join('\n');
}

export async function seoListing(ctx: AgentContext, opts: SeoOptions): Promise<SeoResult> {
  const { slug } = opts;
  if (!slug) {
    const reason = 'no --slug given (run: npm run agent -- seo-listing --slug <tool-slug>)';
    ctx.log.warn('seo.skipped', { reason });
    return { status: 'skipped', reason };
  }
  const repo = opts.repo ?? fsRepo(ctx.config.repoRoot);
  const tool = findTool(slug);
  if (!tool) {
    throw new Escalation({
      title: `SEO/Listing: no worked-example adapter for "${slug}"`,
      context: `A merged PR introduced "${slug}", but agents/seo-listing/src/tools.ts has no entry for it, so its numbers cannot be computed by tools-core.`,
      options: [
        'Add an entry (strings + tools-core example) to agents/seo-listing/src/tools.ts, then re-run with --slug.',
        'Write the listing copy by hand.',
      ],
      recommendation: 'Add the adapter (small PR, with a known-answer test), then re-run.',
      key: `seo-no-adapter-${slug}`,
    });
  }
  const example = tool.example(ctx.config.repoRoot);
  if ('unavailable' in example) {
    throw new Escalation({
      title: `SEO/Listing: cannot publish a worked example for "${slug}"`,
      context: example.unavailable,
      options: ['Verify the data first, then re-run.', 'Skip articles for this tool for now.'],
      recommendation: 'Verify the rates (data/**) before any article is published.',
      key: `seo-no-example-${slug}`,
    });
  }

  const lastVerified = tool.lastVerified(ctx.config.repoRoot);
  const disclaimer = parseDisclaimers(
    repo.read('company/policies/disclaimers.md') ?? '',
    lastVerified,
  );
  const actx: ArticleContext = {
    tool,
    example,
    disclaimer,
    related: TOOLS.filter((t) => t !== tool && pageExists(repo, t.path('en'))),
    lastVerified,
    date: ctx.now().toISOString().slice(0, 10),
  };
  const product = liveProduct(repo.read('products/catalog.json'), slug);
  const exists = (p: string) => pageExists(repo, p);

  const p = promptSections(ctx.readFile('prompt.md'));
  const system = renderTemplate(p.system ?? '', {
    brand_voice: repo.read('company/policies/brand-voice.md') ?? '',
  });
  const user = renderTemplate(p.user ?? '', {
    slug,
    name_en: tool.text.en.h1,
    name_hi: tool.text.hi.h1,
    lead_en: tool.text.en.lead,
    formula: tool.text.en.formula.map((f) => `- ${f}`).join('\n'),
    assumptions: tool.text.en.assumptions.map((a) => `- ${a}`).join('\n'),
    placeholders_en: placeholderList(example, 'en'),
    placeholders_hi: placeholderList(example, 'hi'),
    target_words: targetWords(actx),
  });
  const schema = SeoDraftSchema.superRefine((d, c) => {
    for (const message of draftProblems(d, actx, exists)) c.addIssue({ code: 'custom', message });
  });

  let draft: SeoDraft;
  let family: string;
  try {
    const r = await chatJson(
      ctx.llm,
      {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.4,
      },
      schema,
      'seo-listing draft',
    );
    draft = r.data;
    family = r.response.family;
  } catch (e) {
    if (e instanceof LlmUnavailable && e.attempts.length === 0) {
      const reason = 'no LLM API key set — nothing drafted (worked example computed below)';
      ctx.log.warn('seo.skipped', {
        reason,
        slug,
        example: example.outputs.map((o) => `${o.label.en}: ${o.display.en}`),
      });
      return { status: 'skipped', reason, example };
    }
    throw e;
  }

  const jsonld = {
    en: buildJsonLd({
      tool,
      lang: 'en',
      name: draft.meta.en.title,
      description: draft.meta.en.description,
      faq: draft.faq.en,
      product,
    }),
    hi: buildJsonLd({
      tool,
      lang: 'hi',
      name: draft.meta.hi.title,
      description: draft.meta.hi.description,
      faq: draft.faq.hi,
      product,
    }),
  };
  for (const lang of LANGS) {
    const errors = validateJsonLd(jsonld[lang], { allowOffer: product !== undefined });
    if (errors.length) throw new Error(`JSON-LD (${lang}) invalid: ${errors.join('; ')}`);
  }
  const articles = {
    en: renderArticle(draft, 'en', actx, family),
    hi: renderArticle(draft, 'hi', actx, family),
  };
  const listing: SeoListing = {
    slug,
    meta: draft.meta,
    faq: draft.faq,
    jsonld,
    articles,
    producer_family: family,
  };
  const paths = articlePaths(slug);
  const sidecar = { slug, meta: draft.meta, faq: draft.faq, jsonld, producer_family: family };
  const files = [
    { path: paths.en, content: articles.en },
    { path: paths.hi, content: articles.hi },
    { path: paths.seo, content: `${JSON.stringify(sidecar, null, 2)}\n` },
  ];
  const pr = await ctx.github.openPullRequest({
    branch: `agent/${AGENT}/${slug}`,
    title: `docs(seo): listing copy and help articles for ${slug}`,
    body: prBody(
      listing,
      slug,
      files.map((f) => f.path),
      ctx.dryRun ? '_Dry run: nothing was pushed._' : '',
    ),
    files,
    commitMessage: `docs(seo): listing copy and help articles for ${slug}`,
    labels: ['type:content', `agent:${AGENT}`],
  });
  ctx.log.info('seo.done', {
    slug,
    family,
    pr: pr.number,
    dry_run: pr.dryRun,
    files: files.map((f) => f.path),
  });
  return { status: 'drafted', pr: pr.number, files: files.map((f) => f.path), family, listing };
}

/** Entry point for `npm run agent -- seo-listing --slug <slug>`. Budget from PROCEDURE.md. */
export function main(options?: RunOptions, argv: readonly string[] = cliArgs()) {
  return runAgent(
    AGENT,
    { perRun: 40_000, daily: 80_000 },
    (ctx) => seoListing(ctx, { slug: slugArg(argv) }),
    options,
  );
}
