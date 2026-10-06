import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitHubError, LlmUnavailable } from '../../lib/src/index.js';
import {
  fakeFetch,
  fakeLlm,
  MemoryGitHub,
  memoryLogger,
  testContext,
  testRunOptions,
} from '../../lib/src/testing.js';
import { AGENT, issueBody, main, parseWaitlistCounts, research } from '../src/run.js';

const SOURCES = JSON.stringify({
  sources: [
    {
      id: 'test-ac',
      type: 'autocomplete',
      name: 'Test',
      url_template: 'https://ac.test/s?q={q}&hl={hl}',
      format: 'opensearch',
      languages: ['en', 'hi'],
      terms_url: 'https://ac.test/terms',
      terms_checked: true,
      enabled: true,
    },
  ],
});

function suggestFetch(robots = 'User-agent: *\nAllow: /') {
  return fakeFetch((req) => {
    const u = new URL(req.url);
    if (u.pathname === '/robots.txt') return new Response(robots);
    const q = u.searchParams.get('q') ?? '';
    return new Response(
      JSON.stringify([q, [`${q} rent receipt`, `rent agreement ${q}`, 'posted by ramesh_k']]),
    );
  });
}

const url = (q: string, hl: 'en' | 'hi') => `https://ac.test/s?q=${encodeURIComponent(q)}&hl=${hl}`;

function ideas(over: Record<string, unknown>[] = []) {
  const base = {
    title: 'Rent receipt generator',
    description: 'Monthly rent receipts for tenants and landlords, printable, EN + HI.',
    evidence: [
      { url: url('emi calculator', 'en'), note: 'rent receipt' },
      { url: url('real estate agent calculator', 'en'), note: 'rent receipt' },
    ],
    scores: { demand: 4, effort: 5, uniqueness: 4 },
    total: 99,
    free_or_paid: 'free',
    languages: ['en', 'hi'],
  };
  return JSON.stringify({ ideas: [base, ...over.map((o) => ({ ...base, ...o }))] });
}

const noSleep = async () => undefined;

describe('demand researcher', () => {
  it('no sources enabled: reports waitlist counts only, exit 0, no LLM call', async () => {
    const summary = join(mkdtempSync(join(tmpdir(), 'dr-')), 'summary.md');
    const logger = memoryLogger(AGENT);
    const llm = fakeLlm([]);
    const r = await main(
      testRunOptions(AGENT, {
        llm,
        logger,
        env: {
          DRY_RUN: 'true',
          WAITLIST_COUNTS: '{"lead-tracker":7,"stamp-duty":3,"bad":-1}',
          GITHUB_STEP_SUMMARY: summary,
        },
      }),
    );
    expect(r.status).toBe('ok');
    expect(r.result).toMatchObject({ status: 'no-sources', fetches: 0 });
    expect(r.result?.waitlist.slice(0, 2).map((w) => [w.id, w.count])).toEqual([
      ['lead-tracker', 7],
      ['stamp-duty', 3],
    ]);
    expect(r.result?.message).toContain('no sources enabled');
    expect(llm.requests).toEqual([]);
    expect(readFileSync(summary, 'utf8')).toContain(
      '| Lead & site-visit tracker (Google Sheets) | 7 |',
    );
    expect(logger.lines.some((l) => l.event === 'research.no-sources')).toBe(true);
  });

  it('parses WAITLIST_COUNTS defensively', () => {
    expect(parseWaitlistCounts(undefined)).toBeUndefined();
    expect(parseWaitlistCounts('nope')).toBeUndefined();
    expect(parseWaitlistCounts('[1]')).toBeUndefined();
    expect(parseWaitlistCounts('{"a":2,"b":"x","c":1.5}')).toEqual({ a: 2 });
  });

  it('full run: polite fetches, PII stripped, scored, de-duplicated, Issues (dry run)', async () => {
    const f = suggestFetch();
    const github = new MemoryGitHub({
      agent: AGENT,
      dryRun: true,
      issues: [{ title: 'Idea: Site visit scheduler', labels: ['type:idea'] }],
    });
    const llm = fakeLlm([
      ideas([
        // duplicate of an open idea Issue
        { title: 'Site visit scheduler app' },
        // only one evidence URL from this run (other one invented)
        {
          title: 'Brokerage invoice maker',
          evidence: [
            { url: url('emi calculator', 'en'), note: '' },
            { url: 'https://invented.example/x', note: '' },
          ],
        },
        // regulated → escalated, not an idea Issue
        { title: 'Home loan broker lead finder' },
        {
          title: 'Rent agreement checklist',
          scores: { demand: 5, effort: 3, uniqueness: 5 },
        },
      ]),
    ]);
    const ctx = testContext(AGENT, { llm, github });
    const r = await research(ctx, { sourcesJson: SOURCES, fetch: f, sleep: noSleep });

    expect(r.status).toBe('done');
    // robots.txt fetched once; every request identifies the bot; capped at 50.
    expect(f.calls.filter((c) => c.url.endsWith('/robots.txt'))).toHaveLength(1);
    expect(f.calls.length).toBeLessThanOrEqual(50);
    expect(r.fetches).toBe(f.calls.length);
    expect(f.calls.every((c) => c.headers['user-agent']?.startsWith('ChangeLensResearchBot'))).toBe(
      true,
    );
    // No usernames reach the LLM.
    const prompt = llm.requests[0]?.messages[1]?.content ?? '';
    expect(prompt).toContain('posted by [USER]');
    expect(prompt).not.toContain('ramesh_k');
    expect(prompt).toContain('- Site visit scheduler');

    expect(r.ideas.map((i) => [i.title, i.total])).toEqual([
      ['Rent agreement checklist', 18],
      ['Rent receipt generator', 17],
    ]);
    const created = github.writes.filter((w) => w.action === 'createIssue').map((w) => w.args) as {
      title: string;
      labels: string[];
      body: string;
    }[];
    expect(created.map((c) => c.title)).toEqual([
      expect.stringContaining('Home loan broker lead finder'), // needs-owner escalation
      'Idea: Rent agreement checklist',
      'Idea: Rent receipt generator',
      'Waitlist test: Rent agreement checklist',
    ]);
    expect(created[0]?.labels).toContain('needs-owner');
    expect(created[1]?.labels).toEqual(['type:idea']);
    expect(created[1]?.body).toContain('**Score: 18**');
  });

  it('respects robots.txt: everything disallowed → no evidence, no LLM', async () => {
    const llm = fakeLlm([]);
    const r = await research(testContext(AGENT, { llm }), {
      sourcesJson: SOURCES,
      fetch: suggestFetch('User-agent: ChangeLensResearchBot\nDisallow: /'),
      sleep: noSleep,
    });
    expect(r.status).toBe('no-evidence');
    expect(r.fetches).toBe(1);
    expect(llm.requests).toEqual([]);
  });

  it('no LLM key: reports evidence and exits cleanly; providers down: error', async () => {
    const r = await main(testRunOptions(AGENT, { llm: fakeLlm([new LlmUnavailable([])]) }), {
      sourcesJson: SOURCES,
      fetch: suggestFetch(),
      sleep: noSleep,
    });
    expect(r).toMatchObject({ status: 'ok', result: { status: 'no-llm' } });
    const down = await main(
      testRunOptions(AGENT, {
        llm: fakeLlm([new LlmUnavailable([{ provider: 'p', status: 500, reason: 'x' }])]),
      }),
      { sourcesJson: SOURCES, fetch: suggestFetch(), sleep: noSleep },
    );
    expect(down.status).toBe('error');
  });

  it('cannot read Issues: continues in dry run, fails in live mode', async () => {
    class Broken extends MemoryGitHub {
      override async searchIssues(): Promise<never> {
        throw new GitHubError(401, 'GET', '/search/issues', 'Bad credentials');
      }
    }
    const dry = await research(
      testContext(AGENT, { llm: fakeLlm([ideas()]), github: new Broken({ dryRun: true }) }),
      { sourcesJson: SOURCES, fetch: suggestFetch(), sleep: noSleep },
    );
    expect(dry.status).toBe('done');
    await expect(
      research(
        testContext(AGENT, {
          llm: fakeLlm([ideas()]),
          github: new Broken({ dryRun: false }),
          env: { DRY_RUN: 'false' },
        }),
        { sourcesJson: SOURCES, fetch: suggestFetch(), sleep: noSleep },
      ),
    ).rejects.toThrow('401');
  });

  it('issue body carries the score breakdown and evidence', () => {
    const body = issueBody({
      title: 't',
      description: 'd',
      evidence: [
        { url: 'https://a', note: 'n' },
        { url: 'https://b', note: '' },
      ],
      scores: { demand: 3, effort: 2, uniqueness: 1 },
      total: 9,
      key: 'k',
      free_or_paid: 'paid',
      languages: ['hi'],
    });
    expect(body).toContain('<!-- demand-researcher:idea:k -->');
    expect(body).toContain('demand 3 × 2 + effort 2 (5 = easiest) + uniqueness 1');
    expect(body).toContain('- https://a — n\n- https://b\n');
  });

  it('stops at 50 fetches across sources; ties sort by demand; live message; edge inputs', async () => {
    const three = JSON.stringify({
      sources: ['a', 'b', 'c'].map((id) => ({
        ...(JSON.parse(SOURCES) as { sources: Record<string, unknown>[] }).sources[0],
        id,
        url_template: `https://${id}.test/s?q={q}&hl={hl}`,
      })),
    });
    const f = fakeFetch((req) => {
      const u = new URL(req.url);
      if (u.pathname === '/robots.txt') return new Response('');
      if (u.host === 'c.test') return new Response('["q",[]]');
      return new Response(JSON.stringify(['q', [`${u.searchParams.get('q')} rent receipt`]]));
    });
    const github = new MemoryGitHub({ agent: AGENT, dryRun: false });
    const tieIdeas = JSON.parse(
      ideas([
        {
          title: 'Rent agreement checklist',
          scores: { demand: 5, effort: 2, uniqueness: 2 }, // 14
          evidence: [
            { url: 'https://a.test/s?q=emi%20calculator&hl=en', note: '' },
            { url: 'https://b.test/s?q=emi%20calculator&hl=en', note: '' },
          ],
        },
        {
          title: 'Brokerage note maker',
          scores: { demand: 3, effort: 4, uniqueness: 4 }, // 14
          evidence: [
            { url: 'https://a.test/s?q=emi%20calculator&hl=en', note: '' },
            { url: 'https://b.test/s?q=emi%20calculator&hl=en', note: '' },
          ],
        },
      ]),
    ) as { ideas: unknown[] };
    const tie = JSON.stringify({ ideas: tieIdeas.ideas.slice(1) });
    const r = await research(
      testContext(AGENT, { llm: fakeLlm([tie]), github, env: { DRY_RUN: 'false' } }),
      {
        sourcesJson: three,
        fetch: f,
        sleep: noSleep,
        repo: {
          read: () => null,
          list: () => [],
          exists: () => false,
        },
      },
    );
    expect(f.calls).toHaveLength(50);
    expect(r.waitlist).toEqual([]);
    expect(r.ideas.map((i) => i.title)).toEqual([
      'Rent agreement checklist',
      'Brokerage note maker',
    ]);
    expect(r.message).not.toContain('dry run');
  });

  it('opens nothing when every idea is dropped; non-Error read failures are logged', async () => {
    class Weird extends MemoryGitHub {
      override async searchIssues(): Promise<never> {
        throw 'boom';
      }
    }
    const github = new Weird({ dryRun: true });
    const r = await research(
      testContext(AGENT, {
        llm: fakeLlm([ideas().replace('Rent receipt generator', 'EMI calculator')]),
        github,
      }),
      { sourcesJson: SOURCES, fetch: suggestFetch(), sleep: noSleep },
    );
    expect(r).toMatchObject({ status: 'done', ideas: [], issues: [] });
    expect(github.writes).toEqual([]);
  });
});
