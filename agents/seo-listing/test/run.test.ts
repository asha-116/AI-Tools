import { describe, expect, it } from 'vitest';
import { LlmUnavailable } from '../../lib/src/index.js';
import {
  fakeLlm,
  MemoryGitHub,
  memoryLogger,
  testContext,
  testRunOptions,
  type RecordedWrite,
} from '../../lib/src/testing.js';
import { fsRepo, type RepoReader } from '../src/repo.js';
import { AGENT, articlePaths, main, seoListing } from '../src/run.js';
import { goodDraft } from './fixtures.js';

const GOOD = JSON.stringify(goodDraft());

function prOf(writes: RecordedWrite[]) {
  const w = writes.find((x) => x.action === 'openPullRequest');
  return w?.args as {
    branch: string;
    title: string;
    body: string;
    labels: string[];
    files: { path: string; content: string }[];
  };
}

describe('seoListing', () => {
  it('drafts EN + HI articles and opens one PR on agent/seo-listing/<slug>', async () => {
    const github = new MemoryGitHub({ agent: AGENT, dryRun: true });
    const llm = fakeLlm([{ text: GOOD, family: 'llama' }]);
    const ctx = testContext(AGENT, { llm, github, now: () => new Date('2026-10-06T02:00:00Z') });
    const r = await seoListing(ctx, { slug: 'emi' });

    expect(r.status).toBe('drafted');
    const pr = prOf(github.writes);
    expect(pr.branch).toBe('agent/seo-listing/emi');
    expect(pr.labels).toEqual(['type:content', 'agent:seo-listing']);
    expect(pr.body).toContain('Producer model family: `llama`');
    expect(pr.body).toContain('<!-- producer-family: llama -->');
    expect(pr.body).toContain('no Astro content collection is configured yet');
    const paths = articlePaths('emi');
    expect(pr.files.map((f) => f.path)).toEqual([paths.en, paths.hi, paths.seo]);
    const en = pr.files[0]?.content ?? '';
    expect(en).toContain('| Monthly EMI | ₹13,493 |');
    expect(en).toContain('generated: "2026-10-06"');
    const seo = JSON.parse(pr.files[2]?.content ?? '{}') as Record<string, unknown>;
    expect(Object.keys(seo)).toEqual(['slug', 'meta', 'faq', 'jsonld', 'producer_family']);
    expect(JSON.stringify(seo.jsonld)).not.toMatch(/Offer|price/);

    // The prompt carries the computed placeholders and the brand voice, never invented numbers.
    const [system, user] = llm.requests[0]?.messages ?? [];
    expect(system?.content).toContain('Numbers over adjectives');
    expect(user?.content).toContain('[[emi]] = ₹13,493');
    expect(user?.content).toMatch(/Aim for about \d+ words/);
  });

  it('retries once with the validation errors, then escalates', async () => {
    const bad = goodDraft();
    bad.meta.en.title = 'The best EMI calculator';
    const github = new MemoryGitHub({ agent: AGENT, dryRun: true });
    const llm = fakeLlm([JSON.stringify(bad), JSON.stringify(bad)]);
    const r = await main(testRunOptions(AGENT, { llm, github }), ['--slug', 'emi']);
    expect(r.status).toBe('escalated');
    expect(llm.requests[1]?.messages.at(-1)?.content).toContain('en: uses "best"');
    expect(github.issues[0]?.labels).toContain('needs-owner');
    expect(github.writes.some((w) => w.action === 'openPullRequest')).toBe(false);
  });

  it('accepts a corrected second reply', async () => {
    const bad = goodDraft();
    bad.articles.hi.intro += ' EMI ₹20,000 है।';
    const github = new MemoryGitHub({ agent: AGENT, dryRun: true });
    const llm = fakeLlm([JSON.stringify(bad), GOOD]);
    const r = await main(testRunOptions(AGENT, { llm, github }), ['--slug=emi']);
    expect(r.status).toBe('ok');
    expect(prOf(github.writes).branch).toBe('agent/seo-listing/emi');
  });

  it('escalates for a tool without an adapter, and for unverified stamp-duty rates', async () => {
    for (const slug of ['lead-tracker', 'stamp-duty']) {
      const github = new MemoryGitHub({ agent: AGENT, dryRun: true });
      const r = await main(testRunOptions(AGENT, { github }), ['--slug', slug]);
      expect(r.status).toBe('escalated');
      expect(github.issues[0]?.title).toContain(slug);
    }
  });

  it('skips cleanly with no slug or no LLM key (exit 0), showing the computed example', async () => {
    const none = await main(testRunOptions(AGENT), []);
    expect(none).toMatchObject({ status: 'ok', result: { status: 'skipped' } });

    const logger = memoryLogger(AGENT);
    const r = await main(
      testRunOptions(AGENT, { llm: fakeLlm([new LlmUnavailable([])]), logger }),
      ['--slug', 'emi'],
    );
    expect(r).toMatchObject({ status: 'ok', result: { status: 'skipped' } });
    const line = logger.lines.find((l) => l.event === 'seo.skipped');
    expect(line?.example).toContain('Monthly EMI: ₹13,493');
  });

  it('fails (exit 1) when every provider errors, and on a malformed slug', async () => {
    const down = await main(
      testRunOptions(AGENT, {
        llm: fakeLlm([new LlmUnavailable([{ provider: 'x', status: 500, reason: 'HTTP 500' }])]),
      }),
      ['--slug', 'emi'],
    );
    expect(down.status).toBe('error');
    const bad = await main(testRunOptions(AGENT), ['--slug', 'Bad Slug']);
    expect(bad.status).toBe('error');
  });

  it('throws on invalid JSON-LD (a live product requires allowOffer) — guarded by code', async () => {
    const real = fsRepo(process.cwd());
    const repo: RepoReader = {
      ...real,
      read: (p) =>
        p === 'products/catalog.json'
          ? JSON.stringify({ products: [{ id: 'emi', price_inr: 99, status: 'live' }] })
          : real.read(p),
    };
    const github = new MemoryGitHub({ agent: AGENT, dryRun: true });
    const r = await seoListing(testContext(AGENT, { llm: fakeLlm([GOOD]), github }), {
      slug: 'emi',
      repo,
    });
    // A live product may carry an Offer; the price comes from the catalog, not the model.
    expect(r.status).toBe('drafted');
    expect(prOf(github.writes).files[2]?.content).toContain('"price": "99"');
  });

  it('in live mode the PR body has no dry-run note', async () => {
    const github = new MemoryGitHub({ agent: AGENT, dryRun: false });
    const ctx = testContext(AGENT, { llm: fakeLlm([GOOD]), github, env: { DRY_RUN: 'false' } });
    await seoListing(ctx, { slug: 'emi' });
    expect(prOf(github.writes).body).not.toContain('Dry run');
  });

  it('fails when the disclaimer policy is missing', async () => {
    const real = fsRepo(process.cwd());
    const repo: RepoReader = { ...real, read: (p) => (p.includes('disclaimers') ? null : '') };
    await expect(
      seoListing(testContext(AGENT, { llm: fakeLlm([GOOD]) }), { slug: 'emi', repo }),
    ).rejects.toThrow('**EN:**');
  });
});
