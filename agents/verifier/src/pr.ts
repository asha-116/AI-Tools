// Read-only PR helpers the shared GitHub client lacks (one PR, its changed files).
// TODO(agents/lib): move getPull/listPullFiles into lib/github.ts and MemoryGitHub.

import { GitHubError } from '../../lib/src/index.js';
import type { ChangedFile } from './scope.js';

export interface PrInfo {
  number: number;
  title: string;
  body: string;
  labels: string[];
  draft: boolean;
  headSha: string;
  headRef: string;
  /** "owner/repo" of the head; undefined when the fork was deleted. */
  headRepo: string | undefined;
  baseRepo: string;
}

export interface PrReader {
  getPull(number: number): Promise<PrInfo>;
  listFiles(number: number): Promise<ChangedFile[]>;
}

interface RawPull {
  number: number;
  title: string;
  body?: string | null;
  draft?: boolean;
  labels?: { name?: string }[];
  head: { sha: string; ref: string; repo?: { full_name: string } | null };
  base: { repo: { full_name: string } };
}

const MAX_FILE_PAGES = 30; // GitHub returns at most 3000 files per PR.

export function createPrReader(o: {
  repository: string;
  token: string | undefined;
  fetch?: typeof fetch;
  apiUrl?: string;
}): PrReader {
  if (!/^[\w.-]+\/[\w.-]+$/.test(o.repository)) throw new Error('repository must be "owner/repo"');
  const doFetch = o.fetch ?? fetch;
  const api = (o.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');

  async function get<T>(path: string): Promise<T> {
    const res = await doFetch(`${api}/repos/${o.repository}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'changelens-agent-verifier',
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      },
    });
    if (!res.ok) {
      const detail = await res
        .json()
        .then((j: { message?: unknown }) =>
          typeof j.message === 'string' ? j.message.slice(0, 200) : '',
        )
        .catch(() => '');
      throw new GitHubError(
        res.status,
        'GET',
        `/repos/${o.repository}${path.split('?')[0] as string}`,
        detail,
      );
    }
    return (await res.json()) as T;
  }

  return {
    async getPull(number) {
      const r = await get<RawPull>(`/pulls/${String(number)}`);
      return {
        number: r.number,
        title: r.title,
        body: r.body ?? '',
        labels: (r.labels ?? []).map((l) => l.name ?? ''),
        draft: r.draft ?? false,
        headSha: r.head.sha,
        headRef: r.head.ref,
        headRepo: r.head.repo?.full_name,
        baseRepo: r.base.repo.full_name,
      };
    },
    async listFiles(number) {
      const out: ChangedFile[] = [];
      for (let page = 1; page <= MAX_FILE_PAGES; page++) {
        const batch = await get<ChangedFile[]>(
          `/pulls/${String(number)}/files?per_page=100&page=${String(page)}`,
        );
        for (const f of batch) {
          out.push({
            filename: f.filename,
            status: f.status,
            ...(f.patch === undefined ? {} : { patch: f.patch }),
            ...(f.previous_filename === undefined
              ? {}
              : { previous_filename: f.previous_filename }),
          });
        }
        if (batch.length < 100) break;
      }
      return out;
    },
  };
}
