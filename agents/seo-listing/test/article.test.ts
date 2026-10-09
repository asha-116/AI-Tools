import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  articleBody,
  draftProblems,
  linkTargets,
  renderArticle,
  WORDS,
  type ArticleContext,
} from '../src/article.js';
import { parseDisclaimers } from '../src/disclaimer.js';
import { wordCount } from '../src/policy.js';
import { fsRepo, pageExists } from '../src/repo.js';
import { findTool, TOOLS, type ToolInfo, type WorkedExample } from '../src/tools.js';
import { goodDraft } from './fixtures.js';

const repo = fsRepo(process.cwd());
const exists = (p: string) => pageExists(repo, p);
const emi = findTool('emi') as ToolInfo;

function emiContext(): ArticleContext {
  return {
    tool: emi,
    example: emi.example(process.cwd()) as WorkedExample,
    disclaimer: parseDisclaimers(
      readFileSync('company/policies/disclaimers.md', 'utf8'),
      '2026-09-29',
    ),
    related: TOOLS.filter((t) => t !== emi),
    lastVerified: '2026-09-29',
    date: '2026-10-06',
  };
}

describe('renderArticle', () => {
  const ctx = emiContext();
  const md = renderArticle(goodDraft(), 'en', ctx, 'llama');

  it('has front matter, computed example, formula, FAQ, links and the disclaimer', () => {
    expect(md.startsWith('---\ntitle: "EMI calculator for home loans, with formula"\n')).toBe(true);
    expect(md).toContain('producer_family: "llama"');
    expect(md).toContain('status: "draft"');
    expect(md).toContain('| Monthly EMI | ₹13,493 |');
    expect(md).toContain('For a loan of ₹10,00,000 the EMI is ₹13,493.');
    expect(md).toContain('- EMI = P × r × (1 + r)ⁿ ÷ ((1 + r)ⁿ − 1)');
    expect(md).toContain('### What is an EMI?');
    expect(md).toContain(`> ${ctx.disclaimer.en}`);
    expect(linkTargets(md)).toEqual([
      '/tools/emi/',
      ...TOOLS.filter((t) => t.slug !== 'emi').map((t) => t.path('en')),
      '/',
    ]);
  });

  it('renders Hindi with Hindi headings and /hi/ links', () => {
    const hi = renderArticle(goodDraft(), 'hi', ctx, 'llama');
    expect(hi).toContain('## उदाहरण से समझें');
    expect(hi).toContain('| मासिक EMI | ₹13,493 |');
    expect(linkTargets(hi)).toContain('/hi/');
    expect(linkTargets(hi)).toContain('/hi/tools/commission/');
  });

  it('articleBody strips the front matter', () => {
    expect(articleBody(md).startsWith('\n# EMI calculator')).toBe(true);
  });
});

describe('draftProblems', () => {
  const ctx = emiContext();

  it('accepts a good draft within 600–1,000 words', () => {
    expect(draftProblems(goodDraft(), ctx, exists)).toEqual([]);
    const words = wordCount(articleBody(renderArticle(goodDraft(), 'hi', ctx, 'x')));
    expect(words).toBeGreaterThanOrEqual(WORDS.min);
    expect(words).toBeLessThanOrEqual(WORDS.max);
  });

  it('rejects articles that are too short or too long', () => {
    expect(draftProblems(goodDraft(20), ctx, exists)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^en: article has \d+ words/)]),
    );
    expect(draftProblems(goodDraft(400), ctx, exists).join('\n')).toMatch(/hi: article has/);
  });

  it('rejects banned words, invented numbers, links, headings and unknown placeholders', () => {
    const d = goodDraft();
    d.meta.en.title = 'The best EMI calculator';
    d.articles.en.intro += ' Your EMI will be ₹21,696 at 8.5%. See https://example.com.';
    d.articles.en.how_to_use = `## Steps\n${d.articles.en.how_to_use} [[foo]]`;
    d.faq.hi[0] = { q: 'क्या यह गारंटी है?', a: 'MagicBricks से अलग, जल्दी करें।' };
    const problems = draftProblems(d, ctx, exists);
    expect(problems).toEqual(
      expect.arrayContaining([
        'en: uses "best"',
        'en: "₹21,696" is not a number computed by the tool; use a [[key]]',
        'en: "8.5%" is not a number computed by the tool; use a [[key]]',
        'en: do not write links; code adds them',
        'en: do not write headings; code adds them',
        'en: unknown placeholders: foo',
        'hi: uses "गारंटी" (guarantee)',
        'hi: fake urgency (Hindi)',
        'hi: mentions competitor "MagicBricks"',
      ]),
    );
  });

  it('requires Devanagari in the Hindi fields and resolvable links', () => {
    const d = goodDraft();
    d.meta.hi = { ...d.meta.en };
    d.faq.hi = d.faq.en;
    d.articles.hi = d.articles.en;
    expect(draftProblems(d, ctx, exists)).toContain('hi: must be in Hindi');
    expect(draftProblems(goodDraft(), ctx, () => false)).toContain(
      'en: link /tools/emi/ does not resolve to a page on our site',
    );
  });
});
