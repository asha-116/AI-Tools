import { describe, expect, it } from 'vitest';
import { GitHubError } from '../src/errors.js';
import { escalate, escalationBody, escalationKey, escalationMarker } from '../src/escalate.js';
import { assertAgentBranch, commentMarker, GitHub } from '../src/github.js';
import {
  fakeFetch,
  jsonResponse,
  MemoryGitHub,
  memoryLogger,
  type RecordedRequest,
} from '../src/testing.js';

const TOKEN = 'test-token-' + 'z'.repeat(10);
const SHA = 'a'.repeat(40);
const API = 'https://api.github.com/repos/o/r';

type Route = (req: RecordedRequest) => Response | undefined;

/** Answer requests from a list of routes; unknown requests fail the test with a 599. */
function router(...routes: Route[]) {
  return fakeFetch((req) => {
    for (const r of routes) {
      const res = r(req);
      if (res) return res;
    }
    return jsonResponse({ message: `unrouted ${req.method} ${req.url}` }, 599);
  });
}
const on =
  (method: string, path: string | RegExp, res: (req: RecordedRequest) => Response): Route =>
  (req) => {
    const p = req.url.replace('https://api.github.com', '');
    const match = typeof path === 'string' ? p === path : path.test(p);
    return req.method === method && match ? res(req) : undefined;
  };

function gh(f: typeof fetch, dryRun = false, token: string | null = TOKEN) {
  const log = memoryLogger('builder');
  return {
    client: new GitHub({
      agent: 'builder',
      repository: 'o/r',
      token: token ?? undefined,
      dryRun,
      fetch: f,
      logger: log,
    }),
    log,
  };
}

const rawIssue = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n,
  title: `t${n}`,
  body: null,
  labels: [{ name: 'type:bug' }, 'plain'],
  state: 'open',
  html_url: `https://github.com/o/r/issues/${n}`,
  updated_at: '2026-10-01T00:00:00Z',
  ...extra,
});

describe('assertAgentBranch', () => {
  it.each(['agent/builder/12-emi', 'agent/builder/a/b.c_d'])('accepts %s', (b) => {
    expect(() => assertAgentBranch(b, 'builder')).not.toThrow();
  });
  it.each([
    'main',
    'agent/qa/x',
    'agent/builder/',
    'agent/builder/../main',
    'feature/x',
    'agent/builder/a b',
  ])('refuses %s', (b) => {
    expect(() => assertAgentBranch(b, 'builder')).toThrow(/refusing/);
  });
});

describe('GitHub reads', () => {
  it('listIssues filters PRs, normalises labels, sends auth + API headers', async () => {
    const f = router(
      on('GET', `/repos/o/r/issues?state=open&labels=type%3Abug%2Cx&per_page=100&page=1`, () =>
        jsonResponse([rawIssue(1), rawIssue(2, { pull_request: {} })]),
      ),
    );
    const { client } = gh(f);
    const issues = await client.listIssues({ labels: ['type:bug', 'x'] });
    expect(issues).toEqual([
      {
        number: 1,
        title: 't1',
        body: '',
        labels: ['type:bug', 'plain'],
        state: 'open',
        html_url: 'https://github.com/o/r/issues/1',
        updated_at: '2026-10-01T00:00:00Z',
        is_pull_request: false,
      },
    ]);
    expect(f.calls[0]?.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'changelens-agent-builder',
    });
  });

  it('paginates until a short page and respects limit', async () => {
    const page = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => rawIssue(start + i));
    const f = router(
      on('GET', /issues\?state=all&per_page=100&page=1$/, () => jsonResponse(page(1, 100))),
      on('GET', /issues\?state=all&per_page=100&page=2$/, () => jsonResponse(page(101, 3))),
    );
    const { client } = gh(f);
    expect(await client.listIssues({ state: 'all', limit: 500 })).toHaveLength(103);
    expect(await client.listIssues({ state: 'all', limit: 5 })).toHaveLength(5);
  });

  it('listPulls qualifies head with the owner', async () => {
    const f = router(
      on(
        'GET',
        '/repos/o/r/pulls?state=open&head=o%3Aagent%2Fbuilder%2Fx&per_page=100&page=1',
        () =>
          jsonResponse([
            { ...rawIssue(7), head: { ref: 'agent/builder/x', sha: SHA }, base: { ref: 'main' } },
          ]),
      ),
    );
    const [pr] = await gh(f).client.listPulls({ head: 'agent/builder/x' });
    expect(pr).toMatchObject({
      number: 7,
      head: { ref: 'agent/builder/x', sha: SHA },
      base: 'main',
      draft: false,
    });
  });

  it('searchIssues scopes the query to the repo', async () => {
    const f = router(on('GET', /^\/search\/issues/, () => jsonResponse({ items: [rawIssue(3)] })));
    const r = await gh(f).client.searchIssues('label:needs-owner stale', 10);
    expect(r[0]?.number).toBe(3);
    expect(decodeURIComponent(f.calls[0]?.url ?? '')).toContain(
      'q=repo:o/r label:needs-owner stale&per_page=10',
    );
  });

  it('getFile decodes base64, returns null on 404, refuses unsafe paths', async () => {
    const f = router(
      on('GET', '/repos/o/r/contents/data/a%20b.json?ref=main', () =>
        jsonResponse({ content: Buffer.from('{"x":1}').toString('base64') }),
      ),
      on('GET', '/repos/o/r/contents/missing.md', () =>
        jsonResponse({ message: 'Not Found' }, 404),
      ),
      on('GET', '/repos/o/r/contents/dir', () => jsonResponse([])),
    );
    const { client } = gh(f, false, null);
    expect(await client.getFile('data/a b.json', 'main')).toBe('{"x":1}');
    expect(await client.getFile('missing.md')).toBeNull();
    expect(await client.getFile('dir')).toBeNull();
    expect(f.calls[0]?.headers.authorization).toBeUndefined();
    await expect(client.getFile('../secrets')).rejects.toThrow(/unsafe/);
    await expect(client.getFile('.git/config')).rejects.toThrow(/unsafe/);
  });

  it('throws GitHubError with status and message, never the token', async () => {
    const f = router(on('GET', /issues/, () => jsonResponse({ message: 'Bad credentials' }, 401)));
    const err = await gh(f)
      .client.listIssues()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).message).toBe(
      'GitHub GET /repos/o/r/issues → 401: Bad credentials',
    );
    expect((err as GitHubError).message).not.toContain(TOKEN);
  });

  it('GitHubError tolerates a non-JSON error body', async () => {
    const f = fakeFetch(() => new Response('oops', { status: 502 }));
    await expect(gh(f).client.listPulls()).rejects.toThrow(/→ 502$/);
  });

  it('rejects a malformed repository', () => {
    expect(
      () => new GitHub({ agent: 'x', repository: 'bad', token: undefined, dryRun: true }),
    ).toThrow(/owner\/repo/);
  });
});

describe('GitHub writes in dry-run (the default)', () => {
  it('never sends a write request and returns fake results', async () => {
    const f = router(on('GET', /comments/, () => jsonResponse([])));
    const { client, log } = gh(f, true, null);
    expect(await client.createIssue({ title: 'T', body: 'B', labels: ['x'] })).toEqual({
      dryRun: true,
      number: 0,
      html_url: 'dry-run',
    });
    expect(await client.upsertComment(5, 'hi')).toEqual({
      dryRun: true,
      number: 5,
      html_url: 'dry-run',
      updated: false,
    });
    expect(await client.addLabels(5, ['a'])).toMatchObject({ dryRun: true, number: 5 });
    expect(
      await client.openPullRequest({
        branch: 'agent/builder/x',
        title: 'feat: x',
        body: 'b',
        files: [{ path: 'a.md', content: 'a' }],
      }),
    ).toMatchObject({ dryRun: true });
    expect(
      await client.setCommitStatus(SHA, {
        state: 'success',
        context: 'verifier',
        description: 'ok',
      }),
    ).toMatchObject({ dryRun: true });
    expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
    const dry = log.lines.filter((l) => l.event === 'github.dry-run').map((l) => l.action);
    expect(dry).toEqual([
      'createIssue',
      'upsertComment',
      'addLabels',
      'openPullRequest',
      'setCommitStatus',
    ]);
  });

  it('still enforces branch, path and SHA rules in dry-run', async () => {
    const { client } = gh(router(), true);
    const pr = { title: 't', body: 'b', files: [{ path: 'a.md', content: 'a' }] };
    await expect(client.openPullRequest({ ...pr, branch: 'main' })).rejects.toThrow(/refusing/);
    await expect(
      client.openPullRequest({ ...pr, branch: 'agent/builder/x', base: 'agent/builder/x' }),
    ).rejects.toThrow(/differ/);
    await expect(
      client.openPullRequest({ ...pr, branch: 'agent/builder/x', files: [] }),
    ).rejects.toThrow(/at least one/);
    await expect(
      client.openPullRequest({
        ...pr,
        branch: 'agent/builder/x',
        files: [{ path: '/etc/x', content: '' }],
      }),
    ).rejects.toThrow(/unsafe/);
    await expect(
      client.setCommitStatus('abc', { state: 'error', context: 'c', description: 'd' }),
    ).rejects.toThrow(/SHA/);
  });

  it('a live write without a token is refused', async () => {
    const { client } = gh(router(), false, null);
    await expect(client.createIssue({ title: 't', body: 'b' })).rejects.toThrow(
      /GITHUB_TOKEN is required/,
    );
  });
});

describe('GitHub writes when DRY_RUN=false', () => {
  it('createIssue, addLabels, setCommitStatus', async () => {
    const f = router(
      on('POST', '/repos/o/r/issues', () => jsonResponse(rawIssue(9), 201)),
      on('POST', '/repos/o/r/issues/9/labels', () => jsonResponse([])),
      on('POST', `/repos/o/r/statuses/${SHA}`, () =>
        jsonResponse({ url: 'https://api/status/1' }, 201),
      ),
    );
    const { client } = gh(f);
    expect(await client.createIssue({ title: 'T', body: 'B' })).toEqual({
      dryRun: false,
      number: 9,
      html_url: 'https://github.com/o/r/issues/9',
    });
    expect(await client.addLabels(9, ['x'])).toMatchObject({ dryRun: false, number: 9 });
    expect(
      await client.setCommitStatus(SHA, {
        state: 'failure',
        context: 'verifier',
        description: 'no',
      }),
    ).toMatchObject({
      html_url: 'https://api/status/1',
    });
    expect(f.calls[0]?.body).toEqual({ title: 'T', body: 'B' });
    expect(f.calls[2]?.body).toEqual({ state: 'failure', context: 'verifier', description: 'no' });
  });

  it('upsertComment creates the marked comment, then updates the same one', async () => {
    let comments: { id: number; body: string; html_url: string }[] = [
      { id: 1, body: 'human', html_url: 'u1' },
    ];
    const f = router(
      on('GET', /issues\/4\/comments/, () => jsonResponse(comments)),
      on('POST', '/repos/o/r/issues/4/comments', (req) => {
        comments = [
          ...comments,
          { id: 2, body: (req.body as { body: string }).body, html_url: 'u2' },
        ];
        return jsonResponse({ html_url: 'u2' }, 201);
      }),
      on('PATCH', '/repos/o/r/issues/comments/2', () => jsonResponse({ html_url: 'u2' })),
    );
    const { client } = gh(f);
    expect(await client.upsertComment(4, 'first')).toMatchObject({
      updated: false,
      html_url: 'u2',
    });
    expect(comments[1]?.body).toBe(`${commentMarker('builder')}\nfirst`);
    expect(await client.upsertComment(4, `${commentMarker('builder')}\nsecond`)).toMatchObject({
      updated: true,
    });
    expect(f.calls.at(-1)?.body).toEqual({ body: `${commentMarker('builder')}\nsecond` });
  });

  it('openPullRequest: new branch → one commit with all files → PR → labels', async () => {
    const f = router(
      on('GET', '/repos/o/r/git/ref/heads/agent/builder/12-emi', () =>
        jsonResponse({ message: 'Not Found' }, 404),
      ),
      on('GET', '/repos/o/r/git/ref/heads/main', () => jsonResponse({ object: { sha: 'base1' } })),
      on('GET', '/repos/o/r/git/commits/base1', () => jsonResponse({ tree: { sha: 'tree0' } })),
      on('POST', '/repos/o/r/git/trees', () => jsonResponse({ sha: 'tree1' }, 201)),
      on('POST', '/repos/o/r/git/commits', () => jsonResponse({ sha: 'c1' }, 201)),
      on('POST', '/repos/o/r/git/refs', () => jsonResponse({}, 201)),
      on('GET', /\/pulls\?state=open&head=/, () => jsonResponse([])),
      on('POST', '/repos/o/r/pulls', () => jsonResponse({ number: 15, html_url: 'pr15' }, 201)),
      on('POST', '/repos/o/r/issues/15/labels', () => jsonResponse([])),
    );
    const { client } = gh(f);
    const r = await client.openPullRequest({
      branch: 'agent/builder/12-emi',
      title: 'feat: emi',
      body: 'closes #12',
      files: [
        { path: 'tools-core/src/emi.ts', content: 'export {}' },
        { path: 'old.md', content: null },
      ],
      labels: ['type:tool'],
      draft: true,
    });
    expect(r).toEqual({ dryRun: false, number: 15, html_url: 'pr15' });
    const body = (m: string, p: string) =>
      f.calls.find((c) => c.method === m && c.url.endsWith(p))?.body;
    expect(body('POST', '/git/trees')).toEqual({
      base_tree: 'tree0',
      tree: [
        // Committed in the repo's Prettier style (src/format.ts).
        { path: 'tools-core/src/emi.ts', mode: '100644', type: 'blob', content: 'export {};\n' },
        { path: 'old.md', mode: '100644', type: 'blob', sha: null },
      ],
    });
    expect(body('POST', '/git/commits')).toEqual({
      message: 'feat: emi',
      tree: 'tree1',
      parents: ['base1'],
    });
    expect(body('POST', '/git/refs')).toEqual({
      ref: 'refs/heads/agent/builder/12-emi',
      sha: 'c1',
    });
    expect(body('POST', '/pulls')).toEqual({
      title: 'feat: emi',
      body: 'closes #12',
      head: 'agent/builder/12-emi',
      base: 'main',
      draft: true,
    });
    expect(f.calls.some((c) => c.method === 'PUT' || c.url.includes('/merge'))).toBe(false);
  });

  it('openPullRequest: existing branch is fast-forwarded and the open PR reused', async () => {
    const f = router(
      on('GET', '/repos/o/r/git/ref/heads/agent/builder/x', () =>
        jsonResponse({ object: { sha: 'head1' } }),
      ),
      on('GET', '/repos/o/r/git/commits/head1', () => jsonResponse({ tree: { sha: 't0' } })),
      on('POST', '/repos/o/r/git/trees', () => jsonResponse({ sha: 't1' })),
      on('POST', '/repos/o/r/git/commits', () => jsonResponse({ sha: 'c2' })),
      on('PATCH', '/repos/o/r/git/refs/heads/agent/builder/x', () => jsonResponse({})),
      on('GET', /\/pulls\?state=open&head=/, () =>
        jsonResponse([
          {
            ...rawIssue(8),
            html_url: 'pr8',
            head: { ref: 'agent/builder/x', sha: 'c2' },
            base: { ref: 'main' },
          },
        ]),
      ),
    );
    const r = await gh(f).client.openPullRequest({
      branch: 'agent/builder/x',
      title: 't',
      body: 'b',
      commitMessage: 'fix: again',
      files: [{ path: 'a.md', content: 'a' }],
    });
    expect(r).toEqual({ dryRun: false, number: 8, html_url: 'pr8' });
    expect(f.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ sha: 'c2', force: false });
    expect(
      f.calls.find((c) => c.url.endsWith('/git/commits') && c.method === 'POST')?.body,
    ).toMatchObject({ message: 'fix: again' });
    expect(f.calls.some((c) => c.method === 'POST' && c.url === `${API}/pulls`)).toBe(false);
  });

  it('204 responses are accepted', async () => {
    const f = router(
      on('POST', '/repos/o/r/issues/1/labels', () => new Response(null, { status: 204 })),
    );
    expect(await gh(f).client.addLabels(1, ['x'])).toMatchObject({ number: 1 });
  });
});

describe('escalate', () => {
  const req = {
    title: 'Refund above threshold',
    context: 'Customer rahul@x.com asked for ₹2,000 back (order_DBJOWzybf0sJbb).',
    options: ['Approve refund', 'Decline politely'],
    recommendation: 'Approve: within 7 days of purchase.',
  };

  it('key and marker are stable slugs', () => {
    expect(escalationKey(req)).toBe('refund-above-threshold');
    expect(escalationKey({ ...req, key: 'Custom Key!' })).toBe('custom-key');
    expect(escalationKey({ ...req, title: '!!!' })).toBe('escalation');
    expect(escalationMarker('support', req)).toBe(
      '<!-- escalation:support:refund-above-threshold -->',
    );
  });

  it('body has context, numbered options, recommendation, run link and marker — redacted', () => {
    const body = escalationBody('support', req, 'https://run/1');
    expect(body).toContain('## Context');
    expect(body).toContain('1. Approve refund\n2. Decline politely');
    expect(body).toContain('## Recommendation');
    expect(body).toContain('[run](https://run/1)');
    expect(body).toContain('₹2,000');
    expect(body).not.toMatch(/rahul@x\.com|order_DBJ/);
    expect(body.endsWith(escalationMarker('support', req))).toBe(true);
  });

  it('opens one needs-owner Issue, then comments instead of duplicating', async () => {
    const mem = new MemoryGitHub({ agent: 'support' });
    const first = await escalate(mem, 'support', req, { now: new Date('2026-10-06T00:00:00Z') });
    expect(first).toMatchObject({ deduped: false, number: 1 });
    expect(mem.issues[0]?.labels).toEqual(['needs-owner', 'agent:support']);
    const second = await escalate(mem, 'support', req, {
      runUrl: 'https://run/2',
      now: new Date('2026-10-07T00:00:00Z'),
    });
    expect(second).toMatchObject({ deduped: true, number: 1 });
    expect(mem.issues).toHaveLength(1);
    expect(mem.comments.get(1)?.[0]).toContain(
      'Still blocked as of 2026-10-07T00:00:00.000Z ([run](https://run/2))',
    );
    await escalate(mem, 'support', req);
    expect(mem.comments.get(1)).toHaveLength(1);
  });

  it('in a dry run, a failed read (no token, rate limit) still lets the run continue', async () => {
    class FailingReads extends MemoryGitHub {
      override listIssues(): Promise<never> {
        return Promise.reject(new Error('403 rate limit'));
      }
    }
    const dry = new FailingReads({ agent: 'support', dryRun: true });
    const r = await escalate(dry, 'support', req);
    expect(r.deduped).toBe(false);
    expect(dry.writes.map((w) => w.action)).toEqual(['createIssue']);
    const live = new FailingReads({ agent: 'support', dryRun: false });
    await expect(escalate(live, 'support', req)).rejects.toThrow('403 rate limit');
  });
});
