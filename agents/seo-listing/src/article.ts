// Assemble a help article from the model's prose + code-built parts (worked example, formula,
// links, disclaimer), and check every content rule. Pure: no IO.

import type { ArticleDraft, SeoDraft } from '../schema.js';
import {
  bannedPhrases,
  competitorMentions,
  fakeUrgency,
  unverifiedNumbers,
  wordCount,
} from './policy.js';
import {
  allowedNumbers,
  fillPlaceholders,
  LANGS,
  type Bilingual,
  type Lang,
  type ToolInfo,
  type WorkedExample,
} from './tools.js';

export const WORDS = { min: 600, max: 1000 } as const;

export interface ArticleContext {
  tool: ToolInfo;
  example: WorkedExample;
  /** Full disclaimer from company/policies/disclaimers.md, {last_verified} filled. */
  disclaimer: Bilingual;
  /** Other live tools to link to. */
  related: ToolInfo[];
  lastVerified: string;
  /** Today (YYYY-MM-DD). */
  date: string;
  /** Published sources behind the tool's known answers (the worked example's numbers). */
  sources?: string[];
}

const HEAD: Record<string, Bilingual> = {
  howTo: { en: 'How to use the calculator', hi: 'कैलकुलेटर कैसे इस्तेमाल करें' },
  example: { en: 'Worked example', hi: 'उदाहरण से समझें' },
  formula: { en: 'How it is calculated', hi: 'गणना कैसे होती है' },
  assumptions: { en: 'Assumptions', hi: 'मान्यताएँ' },
  when: { en: 'When it helps', hi: 'यह कब काम आता है' },
  faq: { en: 'Frequently asked questions', hi: 'अक्सर पूछे जाने वाले सवाल' },
  related: { en: 'Related tools', hi: 'और टूल' },
  input: { en: 'Input', hi: 'इनपुट' },
  result: { en: 'Result', hi: 'नतीजा' },
  value: { en: 'Value', hi: 'मान' },
  open: { en: 'Open the calculator', hi: 'कैलकुलेटर खोलें' },
  home: { en: 'All tools', hi: 'सभी टूल' },
  sources: { en: 'Sources', hi: 'स्रोत' },
};

function exampleTable(example: WorkedExample, lang: Lang): string {
  const rows = (kind: 'input' | 'result', values: WorkedExample['inputs']) => [
    `| ${HEAD[kind]?.[lang]} | ${HEAD.value?.[lang]} |`,
    '| --- | ---: |',
    ...values.map((v) => `| ${v.label[lang]} | ${v.display[lang]} |`),
  ];
  return [
    ...rows('input', example.inputs),
    '',
    ...rows('result', example.outputs),
    '',
    `_${example.source[lang]}_`,
  ].join('\n');
}

function yamlString(s: string): string {
  // JSON strings are valid YAML double-quoted scalars.
  return JSON.stringify(s);
}

/** The full markdown file (front matter + body) for one language. */
export function renderArticle(
  draft: SeoDraft,
  lang: Lang,
  ctx: ArticleContext,
  producerFamily: string,
): string {
  const a = draft.articles[lang];
  const fill = (s: string) => fillPlaceholders(s, ctx.example, lang).text;
  const t = ctx.tool.text[lang];
  const home = lang === 'en' ? '/' : '/hi/';
  const front = [
    '---',
    `title: ${yamlString(draft.meta[lang].title)}`,
    `description: ${yamlString(draft.meta[lang].description)}`,
    `slug: ${yamlString(ctx.tool.slug)}`,
    `lang: ${lang}`,
    `tool_path: ${yamlString(ctx.tool.path(lang))}`,
    `last_verified: ${yamlString(ctx.lastVerified)}`,
    `generated: ${yamlString(ctx.date)}`,
    'generated_by: "agent:seo-listing"',
    `producer_family: ${yamlString(producerFamily)}`,
    'status: "draft"',
    '---',
  ];
  const body = [
    `# ${draft.meta[lang].title}`,
    '',
    fill(a.intro),
    '',
    `## ${HEAD.howTo?.[lang]}`,
    '',
    fill(a.how_to_use),
    '',
    `[${HEAD.open?.[lang]}: ${t.h1}](${ctx.tool.path(lang)})`,
    '',
    `## ${HEAD.example?.[lang]}`,
    '',
    exampleTable(ctx.example, lang),
    '',
    `## ${HEAD.formula?.[lang]}`,
    '',
    ...t.formula.map((f) => `- ${f}`),
    '',
    fill(a.formula_explained),
    '',
    `### ${HEAD.assumptions?.[lang]}`,
    '',
    ...t.assumptions.map((s) => `- ${s}`),
    '',
    `## ${HEAD.when?.[lang]}`,
    '',
    fill(a.when_to_use),
    '',
    `## ${HEAD.faq?.[lang]}`,
    '',
    ...draft.faq[lang].flatMap((f) => [`### ${fill(f.q)}`, '', fill(f.a), '']),
    `## ${HEAD.related?.[lang]}`,
    '',
    ...ctx.related.map((r) => `- [${r.text[lang].h1}](${r.path(lang)})`),
    `- [${HEAD.home?.[lang]}](${home})`,
    '',
    ...(ctx.sources?.length
      ? [`## ${HEAD.sources?.[lang]}`, '', ...ctx.sources.map((u) => `- <${u}>`), '']
      : []),
    `> ${ctx.disclaimer[lang]}`,
    '',
  ];
  return [...front, '', ...body].join('\n');
}

/** Body without front matter (for word counts). */
export function articleBody(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
}

/** Markdown link targets, e.g. "/tools/emi/". */
export function linkTargets(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] as string);
}

/** All text the model wrote for one language. */
function modelText(draft: SeoDraft, lang: Lang): string[] {
  const a: ArticleDraft = draft.articles[lang];
  return [
    draft.meta[lang].title,
    draft.meta[lang].description,
    ...draft.faq[lang].flatMap((f) => [f.q, f.a]),
    a.intro,
    a.how_to_use,
    a.formula_explained,
    a.when_to_use,
  ];
}

/**
 * Every rule for a draft. Returns problems (fed back to the model on retry); empty = OK.
 * `pageExists` checks internal links resolve to a real page.
 */
export function draftProblems(
  draft: SeoDraft,
  ctx: ArticleContext,
  pageExists: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  const allowed = allowedNumbers(ctx.example);
  for (const lang of LANGS) {
    const texts = modelText(draft, lang);
    const all = texts.join('\n');
    const tag = (p: string) => `${lang}: ${p}`;
    problems.push(...bannedPhrases(all).map(tag));
    problems.push(...fakeUrgency(all).map(tag));
    problems.push(...competitorMentions(all).map(tag));
    problems.push(...unverifiedNumbers(all, allowed).map((p) => tag(`${p}; use a [[key]]`)));
    for (const t of texts) {
      if (/\bhttps?:\/\/|www\./i.test(t)) problems.push(tag('do not write links; code adds them'));
      if (/^#{1,6}\s/m.test(t)) problems.push(tag('do not write headings; code adds them'));
      const unknown = fillPlaceholders(t, ctx.example, lang).unknown;
      if (unknown.length) problems.push(tag(`unknown placeholders: ${unknown.join(', ')}`));
    }
    if (lang === 'hi' && !/[ऀ-ॿ]/.test(all)) problems.push(tag('must be in Hindi'));

    const md = renderArticle(draft, lang, ctx, 'check');
    const words = wordCount(articleBody(md));
    if (words < WORDS.min || words > WORDS.max) {
      problems.push(
        tag(`article has ${words} words; it must have ${WORDS.min}–${WORDS.max} in total`),
      );
    }
    for (const href of linkTargets(md)) {
      if (!href.startsWith('/') || href.startsWith('//') || !pageExists(href)) {
        problems.push(tag(`link ${href} does not resolve to a page on our site`));
      }
    }
  }
  return [...new Set(problems)];
}
