import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonResponse } from '../../lib/src/testing.js';
import { createPrReader } from '../src/pr.js';

const rawPull = {
  number: 12,
  title: 'feat: x',
  body: null,
  draft: true,
  labels: [{ name: 'approved-by-owner' }, {}],
  head: { sha: 'a'.repeat(40), ref: 'agent/builder/1-x', repo: { full_name: 'asha-116/AI-Tools' } },
  base: { repo: { full_name: 'asha-116/AI-Tools' } },
};

describe('createPrReader', () => {
  it('reads a PR with the token and normalises it', async () => {
    const f = fakeFetch(() => jsonResponse(rawPull));
    const r = createPrReader({ repository: 'asha-116/AI-Tools', token: 't0k3n', fetch: f });
    expect(await r.getPull(12)).toEqual({
      number: 12,
      title: 'feat: x',
      body: '',
      draft: true,
      labels: ['approved-by-owner', ''],
      headSha: 'a'.repeat(40),
      headRef: 'agent/builder/1-x',
      headRepo: 'asha-116/AI-Tools',
      baseRepo: 'asha-116/AI-Tools',
    });
    expect(f.calls[0]?.url).toBe('https://api.github.com/repos/asha-116/AI-Tools/pulls/12');
    expect(f.calls[0]?.headers.authorization).toBe('Bearer t0k3n');
  });

  it('handles a deleted fork (head.repo null) and no token', async () => {
    const f = fakeFetch(() =>
      jsonResponse({
        ...rawPull,
        draft: undefined,
        labels: undefined,
        head: { ...rawPull.head, repo: null },
      }),
    );
    const r = createPrReader({
      repository: 'o/r',
      token: undefined,
      fetch: f,
      apiUrl: 'https://ghe.example/api/',
    });
    const pr = await r.getPull(3);
    expect(pr.headRepo).toBeUndefined();
    expect(pr.labels).toEqual([]);
    expect(pr.draft).toBe(false);
    expect(f.calls[0]?.url).toBe('https://ghe.example/api/repos/o/r/pulls/3');
    expect(f.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('pages through the changed files', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      filename: `f${String(i)}.md`,
      status: 'added',
      patch: '+x',
    }));
    const page2 = [
      { filename: 'legal/terms.md', status: 'renamed', previous_filename: 'legal/old.md' },
    ];
    const f = fakeFetch((req) => jsonResponse(req.url.endsWith('&page=1') ? page1 : page2));
    const files = await createPrReader({ repository: 'o/r', token: 't', fetch: f }).listFiles(5);
    expect(files).toHaveLength(101);
    expect(files[100]).toEqual({
      filename: 'legal/terms.md',
      status: 'renamed',
      previous_filename: 'legal/old.md',
    });
    expect(files[0]).toEqual({ filename: 'f0.md', status: 'added', patch: '+x' });
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=1',
      'https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=2',
    ]);
  });

  it('stops at 30 pages (GitHub lists at most 3000 files)', async () => {
    const full = Array.from({ length: 100 }, () => ({ filename: 'a.md', status: 'added' }));
    const f = fakeFetch(() => jsonResponse(full));
    const files = await createPrReader({ repository: 'o/r', token: 't', fetch: f }).listFiles(1);
    expect(files).toHaveLength(3000);
  });

  it('throws a GitHubError on failure without leaking the token', async () => {
    const f = fakeFetch(() => jsonResponse({ message: 'Not Found' }, 404));
    const r = createPrReader({ repository: 'o/r', token: 'secret-token-123', fetch: f });
    await expect(r.getPull(9)).rejects.toThrow('GitHub GET /repos/o/r/pulls/9 → 404: Not Found');
    const g = fakeFetch(() => new Response('oops', { status: 500 }));
    await expect(
      createPrReader({ repository: 'o/r', token: 't', fetch: g }).getPull(9),
    ).rejects.toThrow('→ 500');
  });

  it('rejects a malformed repository', () => {
    expect(() => createPrReader({ repository: 'nope', token: 't' })).toThrow('owner/repo');
  });
});
