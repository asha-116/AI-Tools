import { describe, expect, it } from 'vitest';
import { createGitHub, findMarkedIssue, markerFor, upsertMarkedIssue } from '../lib/github.mjs';

type Call = { method: string; url: string; body?: unknown; headers?: Record<string, string> };

function fake(routes: (method: string, url: string) => unknown) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: init?.headers as Record<string, string>,
    });
    const out = routes(method, url);
    if (out instanceof Response) return out;
    return new Response(out === undefined ? '' : JSON.stringify(out), { status: 200 });
  };
  return { f, calls };
}

describe('createGitHub', () => {
  it('requires a token', () => {
    expect(() => createGitHub({ token: '' })).toThrow(/token/);
  });

  it('sends auth + API version headers and JSON bodies; empty responses become null', async () => {
    const { f, calls } = fake(() => undefined);
    const gh = createGitHub({ token: 'abc', fetch: f, apiUrl: 'https://api.test' });
    expect(await gh.request('POST', '/x', { a: 1 })).toBeNull();
    expect(calls[0].url).toBe('https://api.test/x');
    expect(calls[0].headers).toMatchObject({
      authorization: 'Bearer abc',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    });
    expect(calls[0].body).toEqual({ a: 1 });
    await gh.request('GET', '/y');
    expect(calls[1].headers?.['content-type']).toBeUndefined();
  });

  it('throws with status and a snippet of the body on errors', async () => {
    const { f } = fake(() => new Response('{"message":"Not Found"}', { status: 404 }));
    const gh = createGitHub({ token: 't', fetch: f });
    await expect(gh.request('GET', '/nope')).rejects.toThrow(
      'GitHub GET /nope → 404: {"message":"Not Found"}',
    );
  });

  it('paginates until a short page or the page cap', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => i);
    const { f, calls } = fake((_m, url) =>
      url.includes('page=3') ? { items: page(5) } : { items: page(100) },
    );
    const gh = createGitHub({ token: 't', fetch: f });
    expect(await gh.paginate('/list?state=open', (p) => p.items)).toHaveLength(205);
    expect(calls.map((c) => c.url.replace('https://api.github.com', ''))).toEqual([
      '/list?state=open&per_page=100&page=1',
      '/list?state=open&per_page=100&page=2',
      '/list?state=open&per_page=100&page=3',
    ]);
    const capped = fake(() => page(100));
    const gh2 = createGitHub({ token: 't', fetch: capped.f });
    expect(await gh2.paginate('/all', undefined, 2)).toHaveLength(200);
    expect(capped.calls[0].url).toContain('/all?per_page=100&page=1');
    const nullPage = fake(() => ({}));
    expect(
      await createGitHub({ token: 't', fetch: nullPage.f }).paginate('/n', (p) => p.missing),
    ).toEqual([]);
  });
});

describe('markerFor / findMarkedIssue', () => {
  it('builds a stable hidden marker that cannot break out of the HTML comment', () => {
    expect(markerFor('workflow-failure:CI')).toBe('<!-- toolshop-alert:workflow-failure:ci -->');
    expect(markerFor('Sync  labels')).toBe('<!-- toolshop-alert:sync-labels -->');
    expect(markerFor('x --> <script>')).toBe('<!-- toolshop-alert:x-script -->');
    expect(markerFor('')).toBe('<!-- toolshop-alert:unnamed -->');
    expect(markerFor('a'.repeat(300))).toHaveLength('<!-- toolshop-alert: -->'.length + 100);
  });

  it('finds only Issues (not PRs) whose body carries the marker', () => {
    const m = markerFor('k');
    const issues = [
      { number: 1, html_url: '', body: null },
      { number: 2, html_url: '', body: `${m}`, pull_request: {} },
      { number: 3, html_url: '', body: `text ${markerFor('other')}` },
      { number: 4, html_url: '', body: `hello\n${m}` },
    ];
    expect(findMarkedIssue(issues, m)?.number).toBe(4);
    expect(findMarkedIssue([], m)).toBeUndefined();
  });
});

describe('upsertMarkedIssue', () => {
  const base = {
    repo: 'o/r',
    marker: markerFor('k'),
    title: 'T',
    body: 'B',
    comment: 'C',
    labels: ['needs-owner'],
  };

  it('opens a new Issue (marker prepended) when none is open', async () => {
    const { f, calls } = fake((m, url) =>
      m === 'GET' ? [] : url.endsWith('/issues') ? { number: 9, html_url: 'u9' } : {},
    );
    const logs: string[] = [];
    const res = await upsertMarkedIssue(createGitHub({ token: 't', fetch: f }), {
      ...base,
      log: (s) => logs.push(s),
    });
    expect(res).toEqual({ action: 'created', number: 9, url: 'u9' });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      body: { title: 'T', body: `${base.marker}\nB`, labels: ['needs-owner'] },
    });
    expect(logs).toEqual(['Opened #9']);
  });

  it('comments on the open Issue; replaces its body only when asked', async () => {
    const open = [{ number: 3, html_url: 'u3', body: `${base.marker}\nold` }];
    const a = fake((m) => (m === 'GET' ? open : {}));
    const res = await upsertMarkedIssue(createGitHub({ token: 't', fetch: a.f }), base);
    expect(res).toEqual({ action: 'commented', number: 3, url: 'u3' });
    expect(a.calls.map((c) => `${c.method} ${c.url.split('/repos/o/r')[1]}`)).toEqual([
      'GET /issues?state=open&per_page=100&page=1',
      'POST /issues/3/comments',
    ]);
    expect(a.calls[1].body).toEqual({ body: 'C' });

    const b = fake((m) => (m === 'GET' ? open : {}));
    await upsertMarkedIssue(createGitHub({ token: 't', fetch: b.f }), {
      ...base,
      body: `${base.marker}\nnew`,
      replaceBody: true,
    });
    expect(b.calls[1]).toMatchObject({ method: 'PATCH', body: { body: `${base.marker}\nnew` } });
  });

  it('only reads in dry-run mode', async () => {
    const logs: string[] = [];
    const none = fake(() => []);
    expect(
      await upsertMarkedIssue(createGitHub({ token: 't', fetch: none.f }), {
        ...base,
        dryRun: true,
        log: (s) => logs.push(s),
      }),
    ).toEqual({ action: 'dry-run', number: undefined });
    const open = fake(() => [{ number: 3, html_url: 'u3', body: base.marker }]);
    expect(
      await upsertMarkedIssue(createGitHub({ token: 't', fetch: open.f }), {
        ...base,
        dryRun: true,
        log: (s) => logs.push(s),
      }),
    ).toEqual({ action: 'dry-run', number: 3 });
    expect([...none.calls, ...open.calls].every((c) => c.method === 'GET')).toBe(true);
    expect(logs[0]).toMatch(/would open "T"/);
    expect(logs[1]).toMatch(/would comment on #3/);
    // silent without a logger
    await upsertMarkedIssue(createGitHub({ token: 't', fetch: none.f }), { ...base, dryRun: true });
  });
});
