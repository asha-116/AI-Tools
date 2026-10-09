import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../lib/src/testing.js';
import { MAX_FETCHES, PoliteFetcher, USER_AGENT } from '../src/fetcher.js';
import {
  buildSeeds,
  escalationReasons,
  ideaKey,
  isDuplicate,
  sanitize,
  titleTokens,
  totalScore,
} from '../src/ideas.js';
import { ALLOW_ALL, isAllowed, parseRobots } from '../src/robots.js';
import {
  enabledSources,
  loadSources,
  parseSuggestions,
  sourceOrigin,
  sourceUrl,
  type Source,
} from '../src/sources.js';

describe('robots.txt', () => {
  const txt = `
# comment
User-agent: *
Disallow: /private
Allow: /private/ok
Disallow: /*.pdf$

User-agent: ChangeLensResearchBot
User-agent: OtherBot
Disallow: /complete
Allow: /complete/search?client=firefox

User-agent: BadBot
Disallow: /
Sitemap: https://x.example/sitemap.xml
`;

  it('uses our own group when named, else *', () => {
    const ours = parseRobots(txt, 'ChangeLensResearchBot');
    expect(ours.disallow).toEqual(['/complete']);
    expect(isAllowed(ours, '/complete/search?client=firefox&q=emi')).toBe(true);
    expect(isAllowed(ours, '/complete/other')).toBe(false);
    expect(isAllowed(ours, '/private')).toBe(true);

    const star = parseRobots(txt, 'SomeoneElse');
    expect(isAllowed(star, '/private/x')).toBe(false);
    expect(isAllowed(star, '/private/ok/1')).toBe(true);
    expect(isAllowed(star, '/a/file.pdf')).toBe(false);
    expect(isAllowed(star, '/a/file.pdf?x')).toBe(true);
    expect(isAllowed(star, '/')).toBe(true);
  });

  it('allows everything without rules; empty Disallow means allow', () => {
    expect(parseRobots('', 'x')).toEqual(ALLOW_ALL);
    expect(parseRobots('Disallow: /orphan\nUser-agent: *\nDisallow:', 'x')).toEqual(ALLOW_ALL);
    expect(isAllowed(ALLOW_ALL, '/anything')).toBe(true);
  });
});

const ORIGIN = 'https://suggest.test';

function fetcherWith(
  robots: string | number | Error,
  opts: { max?: number; status?: number } = {},
) {
  const sleeps: number[] = [];
  let t = 0;
  const f = fakeFetch((req) => {
    if (req.url.endsWith('/robots.txt')) {
      if (robots instanceof Error) throw robots;
      return typeof robots === 'number'
        ? new Response('', { status: robots })
        : new Response(robots, { status: 200 });
    }
    if (req.url.includes('boom')) throw new TypeError('down');
    if (req.url.includes('odd')) throw 'odd';
    if (req.url.includes('nobody')) return new Response(null, { status: 500 });
    return new Response('["q",["a"]]', { status: opts.status ?? 200 });
  });
  const fetcher = new PoliteFetcher({
    fetch: f,
    allowedOrigins: [ORIGIN],
    ...(opts.max ? { maxFetches: opts.max } : {}),
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
  });
  return { f, fetcher, sleeps };
}

describe('PoliteFetcher', () => {
  it('checks robots.txt once, identifies itself, rate-limits and caches', async () => {
    const { f, fetcher, sleeps } = fetcherWith('User-agent: *\nDisallow: /no');
    expect(await fetcher.get(`${ORIGIN}/ac?q=1`)).toEqual({
      ok: true,
      url: `${ORIGIN}/ac?q=1`,
      status: 200,
      text: '["q",["a"]]',
    });
    await fetcher.get(`${ORIGIN}/ac?q=2`);
    await fetcher.get(`${ORIGIN}/ac?q=2`); // cached
    expect(await fetcher.get(`${ORIGIN}/no/x`)).toMatchObject({
      ok: false,
      reason: 'disallowed by robots.txt',
    });
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(['/robots.txt', '/ac', '/ac']);
    expect(f.calls.every((c) => c.headers['user-agent'] === USER_AGENT)).toBe(true);
    expect(sleeps).toEqual([2000, 2000]);
    expect(fetcher.count).toBe(3);
  });

  it('refuses origins that are not enabled sources, and http', async () => {
    const { f, fetcher } = fetcherWith('');
    expect(await fetcher.get('https://other.test/x')).toMatchObject({
      reason: 'origin is not an enabled source',
    });
    expect(await fetcher.get('http://suggest.test/x')).toMatchObject({ ok: false });
    expect(f.calls).toEqual([]);
  });

  it.each([
    [403, false],
    [500, false],
    [404, true],
  ])('robots.txt HTTP %s → allowed: %s', async (status, allowed) => {
    const { fetcher } = fetcherWith(status);
    expect((await fetcher.get(`${ORIGIN}/ac`)).ok).toBe(allowed);
  });

  it('treats an unreachable robots.txt as disallow-all', async () => {
    const { fetcher } = fetcherWith(new TypeError('net'));
    expect(await fetcher.get(`${ORIGIN}/ac`)).toMatchObject({
      reason: 'disallowed by robots.txt',
    });
  });

  it(`stops at the fetch limit (default ${MAX_FETCHES})`, async () => {
    expect(new PoliteFetcher({ fetch: fetch, allowedOrigins: [] }).exhausted).toBe(false);
    const { fetcher } = fetcherWith('', { max: 2 });
    expect((await fetcher.get(`${ORIGIN}/a`)).ok).toBe(true);
    expect(fetcher.exhausted).toBe(true);
    expect(await fetcher.get(`${ORIGIN}/b`)).toMatchObject({ reason: 'fetch limit reached (2)' });
    const other = fetcherWith('', { max: 1 });
    await other.fetcher.get(`${ORIGIN}/a`);
    expect(other.fetcher.count).toBe(1);
    const third = new PoliteFetcher({
      fetch: fetch,
      allowedOrigins: [ORIGIN],
      maxFetches: 0,
    });
    expect(await third.get(`${ORIGIN}/a`)).toMatchObject({ reason: 'fetch limit reached (0)' });
  });

  it('reports HTTP and network errors, and backs off an origin after 429', async () => {
    const { fetcher } = fetcherWith('', { status: 429 });
    expect(await fetcher.get(`${ORIGIN}/a`)).toMatchObject({ reason: 'HTTP 429' });
    expect(await fetcher.get(`${ORIGIN}/b`)).toMatchObject({
      reason: 'origin rate-limited us earlier in this run',
    });
    const net = fetcherWith('');
    expect(await net.fetcher.get(`${ORIGIN}/boom`)).toMatchObject({
      reason: 'network error (TypeError)',
    });
    expect(await net.fetcher.get(`${ORIGIN}/odd`)).toMatchObject({
      reason: 'network error (Error)',
    });
    expect(await net.fetcher.get(`${ORIGIN}/nobody`)).toMatchObject({ reason: 'HTTP 500' });
  });
});

describe('sources', () => {
  const file = readFileSync('agents/demand-researcher/sources.json', 'utf8');

  it('ships every candidate disabled with terms_checked false', () => {
    const all = loadSources(file);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => !s.enabled && !s.terms_checked)).toBe(true);
    expect(enabledSources(all)).toEqual([]);
  });

  const src = (over: Partial<Source>) =>
    JSON.stringify({
      sources: [
        {
          id: 's',
          type: 'autocomplete',
          name: 'S',
          url_template: 'https://s.test/ac?q={q}&hl={hl}',
          format: 'opensearch',
          languages: ['en'],
          terms_url: 'https://s.test/terms',
          terms_checked: true,
          enabled: true,
          ...over,
        },
      ],
    });

  it('refuses enabled-without-terms, other types and templates without {q}', () => {
    expect(() => loadSources(src({ terms_checked: false }))).toThrow('terms_checked');
    expect(() => loadSources(src({ type: 'forum' as 'autocomplete' }))).toThrow();
    expect(() => loadSources(src({ url_template: 'https://s.test/x' }))).toThrow('{q}');
    expect(() => loadSources(src({ url_template: 'http://s.test/?q={q}' }))).toThrow();
  });

  it('builds URLs and origins', () => {
    const [s] = enabledSources(loadSources(src({})));
    expect(sourceUrl(s as Source, 'स्टांप ड्यूटी', 'hi')).toBe(
      'https://s.test/ac?q=%E0%A4%B8%E0%A5%8D%E0%A4%9F%E0%A4%BE%E0%A4%82%E0%A4%AA%20%E0%A4%A1%E0%A5%8D%E0%A4%AF%E0%A5%82%E0%A4%9F%E0%A5%80&hl=hi',
    );
    expect(sourceOrigin(s as Source)).toBe('https://s.test');
  });

  it('parses opensearch and ddg bodies defensively', () => {
    expect(parseSuggestions('opensearch', '["emi",["emi calculator"," emi sbi ",""]]')).toEqual([
      'emi calculator',
      'emi sbi',
    ]);
    expect(parseSuggestions('ddg', '[{"phrase":"stamp duty"},{"x":1},"raw"]')).toEqual([
      'stamp duty',
      'raw',
    ]);
    expect(parseSuggestions('opensearch', '{"a":1}')).toEqual([]);
    expect(parseSuggestions('ddg', 'not json')).toEqual([]);
    expect(parseSuggestions('ddg', '{}')).toEqual([]);
  });
});

describe('ideas helpers', () => {
  it('builds EN + HI seeds from tools and the profession, de-duplicated and capped', () => {
    const seeds = buildSeeds([
      { en: 'EMI calculator', hi: 'EMI कैलकुलेटर' },
      { en: 'emi  calculator!', hi: 'EMI कैलकुलेटर' },
    ]);
    // Profession seeds come first so they are never crowded out by a long tool list.
    expect(seeds[0]).toEqual({ q: 'real estate agent calculator', lang: 'en' });
    expect(seeds.filter((x) => x.q.startsWith('emi'))).toEqual([
      { q: 'emi calculator', lang: 'en' },
      { q: 'emi कैलकुलेटर', lang: 'hi' },
    ]);
    expect(seeds).toContainEqual({ q: 'property dealer excel template', lang: 'en' });
    const many = Array.from({ length: 30 }, (_, i) => ({
      en: `tool ${String(i)}`,
      hi: `टूल ${String(i)}`,
    }));
    expect(buildSeeds(many)).toContainEqual({ q: 'प्रॉपर्टी डीलर कैलकुलेटर', lang: 'hi' });
    expect(seeds).toContainEqual({ q: 'प्रॉपर्टी डीलर कैलकुलेटर', lang: 'hi' });
    expect(buildSeeds([], 3)).toHaveLength(3);
  });

  it('strips usernames and PII before the LLM', () => {
    const out = sanitize(
      'posted by ramesh123: @agent_k u/broker_22 see /user/sam.k call 9876543210 or a@b.co',
    );
    expect(out).not.toMatch(/ramesh123|agent_k|broker_22|sam\.k|9876543210|a@b\.co/);
    expect(out).toContain('[USER]');
  });

  it('total = demand × 2 + effort + uniqueness, each 1–5', () => {
    expect(totalScore({ demand: 5, effort: 4, uniqueness: 3 })).toBe(17);
    expect(totalScore({ demand: 1, effort: 1, uniqueness: 1 })).toBe(4);
    expect(totalScore({ demand: 5, effort: 5, uniqueness: 5 })).toBe(20);
    expect(() => totalScore({ demand: 6, effort: 1, uniqueness: 1 })).toThrow('demand');
    expect(() => totalScore({ demand: 1, effort: 2.5, uniqueness: 1 })).toThrow('effort');
  });

  it('detects duplicates by shared title tokens', () => {
    expect(titleTokens('The EMI calculator for India')).toEqual(new Set(['emi', 'calculator']));
    expect(isDuplicate('Home loan EMI calculator', ['EMI calculator'])).toBe(true);
    expect(isDuplicate('Rent receipt generator', ['EMI calculator'])).toBe(false);
    expect(isDuplicate('the a', ['EMI'])).toBe(false);
    expect(ideaKey('Rent receipt — generator!')).toBe('generator-receipt-rent');
  });

  it('flags advice, regulated activity and prices above ₹999', () => {
    expect(escalationReasons('Loan broker lead finder')).toEqual(['involves a regulated activity']);
    expect(escalationReasons('Tax advice bot')).toEqual(['involves legal/tax/investment advice']);
    expect(escalationReasons('Pro pack at ₹1,499')).toEqual(['mentions a price above ₹999']);
    expect(escalationReasons('Template at Rs 299')).toEqual([]);
  });
});
