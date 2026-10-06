// Social draft rules, rendering and topic choice. Pure: no IO.

import { SHORT_DISCLAIMER } from '../../seo-listing/src/disclaimer.js';
import {
  bannedPhrases,
  competitorMentions,
  externalLinks,
  fakeUrgency,
  personTags,
  SITE_ORIGIN,
  sensitiveTopics,
  unverifiedNumbers,
  wordCount,
} from '../../seo-listing/src/policy.js';
import {
  allowedNumbers,
  fillPlaceholders,
  type Lang,
  type ToolInfo,
  type WorkedExample,
} from '../../seo-listing/src/tools.js';
import type { SocialDraft, SocialPost } from '../schema.js';

export const QUEUE_DIR = 'company/social-queue';
export const SCRIPT_WORDS = { min: 60, max: 130 } as const;

/** company/social-queue/<YYYY-MM-DD>-<slug>.md */
export function queuePath(date: string, slug: string): string {
  return `${QUEUE_DIR}/${date}-${slug}.md`;
}

/** Slug of a queue file name, or undefined for other files. */
export function slugOfQueueFile(name: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}-([a-z0-9-]+)\.md$/.exec(name)?.[1];
}

function allText(d: SocialDraft): string {
  return [d.script, d.caption.en, d.caption.hi, d.pin_text, ...d.hashtags].join('\n');
}

/** Rule problems fed back to the model on retry; empty = OK. */
export function draftProblems(d: SocialDraft, example: WorkedExample): string[] {
  const text = allText(d);
  const problems = [
    ...bannedPhrases(text),
    ...fakeUrgency(text),
    ...personTags(text),
    ...unverifiedNumbers(text, allowedNumbers(example)).map((p) => `${p}; use a [[key]]`),
  ];
  if (/\bhttps?:\/\/|www\./i.test(text)) problems.push('do not write links; code adds them');
  const fields: [string, Lang][] = [
    [d.script, 'en'],
    [d.caption.en, 'en'],
    [d.caption.hi, 'hi'],
    [d.pin_text, 'en'],
  ];
  for (const [t, lang] of fields) {
    const unknown = fillPlaceholders(t, example, lang).unknown;
    if (unknown.length) problems.push(`unknown placeholders: ${unknown.join(', ')}`);
  }
  const words = wordCount(d.script);
  if (words < SCRIPT_WORDS.min || words > SCRIPT_WORDS.max) {
    problems.push(
      `script has ${words} words; a 30–45 s script needs ${SCRIPT_WORDS.min}–${SCRIPT_WORDS.max}`,
    );
  }
  if (!/[ऀ-ॿ]/.test(d.caption.hi)) problems.push('caption.hi must be in Hindi');
  return [...new Set(problems)];
}

/** Topics the owner must look at before any draft is written (PROCEDURE escalation rule). */
export function escalationReasons(d: SocialDraft): string[] {
  const text = allText(d);
  return [...sensitiveTopics(text), ...competitorMentions(text)];
}

/** Fill placeholders, add our link and (money topics) the disclaimer line. */
export function finalizePost(d: SocialDraft, tool: ToolInfo, example: WorkedExample): SocialPost {
  const fill = (s: string, lang: Lang) => fillPlaceholders(s, example, lang).text;
  const caption = (lang: Lang) =>
    [
      fill(d.caption[lang], lang),
      `${SITE_ORIGIN}${tool.path(lang)}`,
      ...(tool.moneyTopic ? [SHORT_DISCLAIMER[lang]] : []),
    ].join('\n\n');
  return {
    slug: tool.slug,
    status: 'draft',
    script: fill(d.script, 'en'),
    caption: { en: caption('en'), hi: caption('hi') },
    pin_text: fill(d.pin_text, 'en'),
    hashtags: d.hashtags,
  };
}

/** Final gate on what is written: our links only, disclaimer present, still a draft. */
export function postProblems(post: SocialPost, tool: ToolInfo): string[] {
  const text = [post.script, post.caption.en, post.caption.hi, post.pin_text].join('\n');
  const problems = externalLinks(text).map((u) => `links outside our site: ${u}`);
  if (tool.moneyTopic) {
    for (const lang of ['en', 'hi'] as const) {
      if (!post.caption[lang].includes(SHORT_DISCLAIMER[lang])) {
        problems.push(`caption.${lang} is missing the disclaimer line`);
      }
    }
  }
  if (post.status !== 'draft') problems.push('status must be draft');
  return problems;
}

export function renderPost(
  post: SocialPost,
  meta: { date: string; postType: string; family: string },
): string {
  return [
    '---',
    `status: ${post.status}`,
    `slug: ${post.slug}`,
    `date: ${meta.date}`,
    `type: ${meta.postType}`,
    'generated_by: "agent:social"',
    `producer_family: ${JSON.stringify(meta.family)}`,
    '---',
    '',
    `# Social draft — ${post.slug} (${meta.date})`,
    '',
    '> DRAFT — not posted. The owner reviews and publishes by hand (agents never post).',
    '',
    '## Script (30–45 s)',
    '',
    post.script,
    '',
    '## Caption (EN)',
    '',
    post.caption.en,
    '',
    '## Caption (HI)',
    '',
    post.caption.hi,
    '',
    '## Pin text',
    '',
    post.pin_text,
    '',
    '## Hashtags',
    '',
    post.hashtags.join(' '),
    '',
  ].join('\n');
}

/** First line of the EN caption in a rendered draft (to avoid repeating a hook). */
export function captionHook(markdown: string): string | undefined {
  return /## Caption \(EN\)\n\n(.+)/.exec(markdown)?.[1]?.trim();
}

/**
 * Weekly evergreen tip: the tool with the fewest past drafts (registry order breaks ties),
 * among tools whose worked example can be published.
 */
export function pickTool(
  tools: readonly ToolInfo[],
  queueFiles: readonly string[],
  hasExample: (t: ToolInfo) => boolean,
): ToolInfo | undefined {
  const counts = new Map<string, number>();
  for (const f of queueFiles) {
    const slug = slugOfQueueFile(f);
    if (slug) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  let best: ToolInfo | undefined;
  for (const t of tools) {
    if (!hasExample(t)) continue;
    if (!best || (counts.get(t.slug) ?? 0) < (counts.get(best.slug) ?? 0)) best = t;
  }
  return best;
}
