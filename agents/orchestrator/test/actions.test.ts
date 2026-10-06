import { describe, expect, it } from 'vitest';
import { GitHubError } from '../../lib/src/index.js';
import { fakeFetch, jsonResponse } from '../../lib/src/testing.js';
import { listWorkflowRuns } from '../src/actions.js';

describe('listWorkflowRuns', () => {
  it('reads completed runs on main since a date, with the token', async () => {
    const f = fakeFetch(() =>
      jsonResponse({
        workflow_runs: [
          {
            name: 'CI',
            path: '.github/workflows/ci.yml',
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.com/o/r/actions/runs/1',
            created_at: '2026-10-05T00:00:00Z',
          },
          { path: '.github/workflows/x.yml' },
          {},
        ],
      }),
    );
    const runs = await listWorkflowRuns(
      { repository: 'o/r', token: ['fake', 'token'].join('-'), fetch: f, apiUrl: 'https://api.test/' },
      '2026-09-29',
    );
    const url = new URL(f.calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.test/repos/o/r/actions/runs');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      branch: 'main',
      status: 'completed',
      created: '>=2026-09-29',
    });
    expect(f.calls[0]?.headers['authorization']).toBe('Bearer fake-token');
    expect(runs).toEqual([
      {
        name: 'CI',
        path: '.github/workflows/ci.yml',
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/o/r/actions/runs/1',
        created_at: '2026-10-05T00:00:00Z',
      },
      {
        name: '.github/workflows/x.yml',
        path: '.github/workflows/x.yml',
        status: 'unknown',
        conclusion: null,
        html_url: '',
        created_at: '',
      },
      {
        name: 'unnamed workflow',
        path: '',
        status: 'unknown',
        conclusion: null,
        html_url: '',
        created_at: '',
      },
    ]);
  });

  it('works without a token and tolerates a missing list', async () => {
    const f = fakeFetch(() => jsonResponse({}));
    expect(await listWorkflowRuns({ repository: 'o/r', token: undefined, fetch: f }, 'x')).toEqual(
      [],
    );
    expect(f.calls[0]?.url.startsWith('https://api.github.com/')).toBe(true);
    expect(f.calls[0]?.headers['authorization']).toBeUndefined();
  });

  it('throws GitHubError on non-2xx and rejects bad repositories', async () => {
    const f = fakeFetch(() => jsonResponse({ message: 'nope' }, 403));
    await expect(
      listWorkflowRuns({ repository: 'o/r', token: undefined, fetch: f }, 'x'),
    ).rejects.toBeInstanceOf(GitHubError);
    await expect(
      listWorkflowRuns({ repository: 'bad', token: undefined, fetch: f }, 'x'),
    ).rejects.toThrow('owner/repo');
  });
});
