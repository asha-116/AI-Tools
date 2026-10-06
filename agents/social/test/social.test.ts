import { describe, expect, it } from 'vitest';
import { LlmUnavailable } from '../../lib/src/index.js';
import {
  completion,
  fakeFetch,
  fakeLlm,
  jsonResponse,
  MemoryGitHub,
  memoryLogger,
  testContext,
  testRunOptions,
} from '../../lib/src/testing.js';
import { fsRepo, type RepoReader } from '../../seo-listing/src/repo.js';
import { findTool, TOOLS, type ToolInfo, type WorkedExample } from '../../seo-listing/src/tools.js';
import type { SocialDraft } from '../schema.js';
import {
  captionHook,
  draftProblems,
  escalationReasons,
  finalizePost,
  pickTool,
  postProblems,
  queuePath,
  renderPost,
  slugOfQueueFile,
} from '../src/post.js';
import { AGENT, main, social } from '../src/run.js';

const emi = findTool('emi') as ToolInfo;
const example = emi.example(process.cwd()) as WorkedExample;
const NOW = () => new Date('2026-10-08T04:13:00Z');

const SCRIPT =
  'Your buyer asks what the monthly EMI will be. Open the ChangeLens EMI calculator on your phone. ' +
  'Step one, type the loan amount, say [[principal]]. Step two, type the yearly interest rate, [[rate]]. ' +
  'Step three, pick the tenure, [[tenure]]. The page shows an EMI of [[emi]] and total interest of [[interest]]. ' +
  'Tap copy link and send the result to your buyer on WhatsApp. It shows the formula too, so you can explain every number. ' +
  'Nothing you type leaves your phone.';

function goodDraft(): SocialDraft {
  return {
    script: SCRIPT,
    caption: {
      en: 'Explain a home-loan EMI in seconds: [[principal]] at [[rate]] is [[emi]] a month.',
      hi: 'होम लोन की EMI सेकंडों में समझाएँ: [[principal]] पर [[emi]] महीना।',
    },
    pin_text: 'EMI for [[principal]]: [[emi]] a month',
    hashtags: ['#RealEstateIndia', '#HomeLoan', '#EMI'],
  };
}
const GOOD = JSON.stringify(goodDraft());

describe('post rules', () => {
  it('accepts a good draft', () => {
    expect(draftProblems(goodDraft(), example)).toEqual([]);
    expect(escalationReasons(goodDraft())).toEqual([]);
  });

  it('rejects promises, urgency, tags, links, invented numbers, bad length and non-Hindi', () => {
    const d = goodDraft();
    d.script = 'Hurry! Earn ₹50,000 a month, ask @ramesh. https://x.example [[nope]]';
    d.caption.hi = 'English only caption here';
    const p = draftProblems(d, example);
    expect(p).toEqual(
      expect.arrayContaining([
        'promises earnings',
        'fake urgency',
        'tags @ramesh',
        '"₹50,000" is not a number computed by the tool; use a [[key]]',
        'do not write links; code adds them',
        'unknown placeholders: nope',
        expect.stringMatching(/^script has \d+ words/),
        'caption.hi must be in Hindi',
      ]),
    );
  });

  it('flags news/politics/competitors for the owner', () => {
    const d = goodDraft();
    d.caption.en = 'After the RBI hike and unlike 99acres, try this.';
    expect(escalationReasons(d)).toEqual([
      'news / politics / regulation change',
      'mentions competitor "99acres"',
    ]);
  });

  it('finalizes: fills numbers, adds our link and the disclaimer, status draft', () => {
    const post = finalizePost(goodDraft(), emi, example);
    expect(post.status).toBe('draft');
    expect(post.caption.en).toContain('₹10,00,000 at 10.5% is ₹13,493 a month.');
    expect(post.caption.en).toContain('https://tools.changelense.in/tools/emi/');
    expect(post.caption.hi).toContain('https://tools.changelense.in/hi/tools/emi/');
    expect(post.caption.en).toContain('For estimation only — verify with a professional.');
    expect(post.caption.hi).toContain('केवल अनुमान के लिए');
    expect(postProblems(post, emi)).toEqual([]);
    const plain = finalizePost(goodDraft(), { ...emi, moneyTopic: false }, example);
    expect(plain.caption.en).not.toContain('For estimation only');
    expect(postProblems(plain, { ...emi, moneyTopic: false })).toEqual([]);
    const bad = {
      ...post,
      status: 'posted' as 'draft',
      caption: { en: 'see http://x.io', hi: '' },
    };
    expect(postProblems(bad, emi)).toEqual([
      'links outside our site: http://x.io',
      'caption.en is missing the disclaimer line',
      'caption.hi is missing the disclaimer line',
      'status must be draft',
    ]);
    const md = renderPost(post, { date: '2026-10-08', postType: 'weekly-tip', family: 'llama' });
    expect(md).toContain('status: draft');
    expect(md).toContain('DRAFT — not posted');
    expect(captionHook(md)).toBe(
      'Explain a home-loan EMI in seconds: ₹10,00,000 at 10.5% is ₹13,493 a month.',
    );
    expect(captionHook('nothing')).toBeUndefined();
  });

  it('queue file names and topic rotation', () => {
    expect(queuePath('2026-10-08', 'emi')).toBe('company/social-queue/2026-10-08-emi.md');
    expect(slugOfQueueFile('2026-10-01-stamp-duty.md')).toBe('stamp-duty');
    expect(slugOfQueueFile('.gitkeep')).toBeUndefined();
    const all = () => true;
    expect(pickTool(TOOLS, [], all)?.slug).toBe('emi');
    expect(pickTool(TOOLS, ['2026-10-01-emi.md', '.gitkeep'], all)?.slug).toBe('commission');
    expect(pickTool(TOOLS, ['2026-10-01-emi.md'], (t) => t.slug === 'emi')?.slug).toBe('emi');
    expect(pickTool(TOOLS, [], () => false)).toBeUndefined();
  });
});

function repoWith(files: Record<string, string>): RepoReader {
  const real = fsRepo(process.cwd());
  return {
    read: (p) => files[p] ?? real.read(p),
    list: (d) =>
      d === 'company/social-queue'
        ? Object.keys(files).map((f) => f.split('/').pop() as string)
        : real.list(d),
    exists: (p) => p in files || real.exists(p),
  };
}

describe('social run', () => {
  it('weekly tip: drafts the least-covered tool and opens a draft PR', async () => {
    const github = new MemoryGitHub({ agent: AGENT, dryRun: true });
    const llm = fakeLlm([{ text: GOOD, family: 'gemini' }]);
    const repo = repoWith({
      'company/social-queue/2026-10-01-commission.md': renderPost(
        finalizePost(goodDraft(), emi, example),
        { date: '2026-10-01', postType: 'x', family: 'y' },
      ),
    });
    const r = await social(testContext(AGENT, { llm, github, now: NOW }), {
      slug: undefined,
      repo,
    });
    expect(r).toMatchObject({ status: 'drafted', path: 'company/social-queue/2026-10-08-emi.md' });
    const pr = github.writes[0]?.args as {
      branch: string;
      body: string;
      files: { path: string; content: string }[];
    };
    expect(pr.branch).toBe('agent/social/2026-10-08-emi');
    expect(pr.body).toContain('Producer model family: `gemini`');
    expect(pr.files[0]?.content).toContain('status: draft');
    expect(llm.requests[0]?.messages[1]?.content).toContain('weekly evergreen tip');
  });

  it('new tool: passes recent hooks for the same tool so the model does not repeat them', async () => {
    const llm = fakeLlm([GOOD]);
    const repo = repoWith({
      'company/social-queue/2026-10-01-emi.md': '## Caption (EN)\n\nOld hook line\n',
    });
    const r = await social(testContext(AGENT, { llm, now: NOW }), { slug: 'emi', repo });
    expect(r.status).toBe('drafted');
    expect(llm.requests[0]?.messages[1]?.content).toContain('- Old hook line');
    expect(llm.requests[0]?.messages[1]?.content).toContain('new free tool');
  });

  it('skips when today’s draft exists, or when no tool can be drafted', async () => {
    const repo = repoWith({ 'company/social-queue/2026-10-08-emi.md': 'x' });
    const r = await social(testContext(AGENT, { now: NOW }), { slug: 'emi', repo });
    expect(r).toEqual({
      status: 'skipped',
      reason: 'company/social-queue/2026-10-08-emi.md already exists',
    });
    const none = await social(testContext(AGENT, { now: NOW }), { slug: undefined, tools: [] });
    expect(none).toEqual({
      status: 'skipped',
      reason: 'no tool with a publishable worked example',
    });
  });

  it('escalates for unknown/unverified tools and sensitive topics', async () => {
    for (const slug of ['nope', 'stamp-duty']) {
      const github = new MemoryGitHub({ agent: AGENT, dryRun: true });
      const r = await main(testRunOptions(AGENT, { github, now: NOW }), ['--slug', slug]);
      expect(r.status).toBe('escalated');
    }
    const d = goodDraft();
    d.caption.en += ' Unlike MagicBricks.';
    const github = new MemoryGitHub({ agent: AGENT, dryRun: true });
    const r = await main(
      testRunOptions(AGENT, { github, llm: fakeLlm([JSON.stringify(d)]), now: NOW }),
      ['--slug', 'emi'],
    );
    expect(r.status).toBe('escalated');
    expect(github.writes.some((w) => w.action === 'openPullRequest')).toBe(false);
  });

  it('no LLM key: skipped, exit 0; providers down: error', async () => {
    const r = await main(
      testRunOptions(AGENT, { llm: fakeLlm([new LlmUnavailable([])]), now: NOW }),
      [],
    );
    expect(r).toMatchObject({ status: 'ok', result: { status: 'skipped' } });
    const down = await main(
      testRunOptions(AGENT, {
        llm: fakeLlm([new LlmUnavailable([{ provider: 'p', status: 503, reason: 'HTTP 503' }])]),
        now: NOW,
      }),
      [],
    );
    expect(down.status).toBe('error');
  });

  it('never calls anything but the LLM and GitHub (no social API), even in live mode', async () => {
    const f = fakeFetch((req) => {
      const host = new URL(req.url).host;
      if (host === 'llm.test') return jsonResponse(completion(GOOD));
      if (host === 'api.github.com') {
        if (req.url.includes('/git/ref/heads/agent')) return jsonResponse({}, 404);
        if (req.url.includes('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'a' } });
        if (req.url.includes('/git/commits/a')) return jsonResponse({ tree: { sha: 't' } });
        if (req.url.includes('/git/trees')) return jsonResponse({ sha: 't2' });
        if (req.url.includes('/git/commits')) return jsonResponse({ sha: 'c' });
        if (req.url.includes('/git/refs')) return jsonResponse({ ref: 'x' });
        if (req.url.includes('/pulls?')) return jsonResponse([]);
        if (req.url.endsWith('/pulls')) return jsonResponse({ number: 7, html_url: 'u' });
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch to ${req.url}`);
    });
    const r = await main(
      {
        env: { DRY_RUN: 'false', GITHUB_TOKEN: 'gh-token-xxxxxxxx', LLM_KEY: 'k-xxxxxxxxxxxx' },
        providers: [
          {
            id: 'fake',
            baseUrl: 'https://llm.test/v1',
            keyEnv: 'LLM_KEY',
            model: 'm',
            family: 'llama',
            limits: {},
          },
        ],
        fetch: f,
        logger: memoryLogger(AGENT),
        usedToday: 0,
        now: NOW,
      },
      ['--slug', 'emi'],
    );
    expect(r).toMatchObject({ status: 'ok', result: { status: 'drafted', pr: 7 } });
    const hosts = new Set(f.calls.map((c) => new URL(c.url).host));
    expect([...hosts].sort()).toEqual(['api.github.com', 'llm.test']);
  });
});
