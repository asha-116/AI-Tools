// Minimal GitHub REST client for agents.
//
// Safety rails (AGENTS.md rule 3):
// - Every write is a no-op returning a fake result unless DRY_RUN is exactly 'false'.
// - There is no merge method and no way to write to `main`: commits go only to branches named
//   `agent/<agent>/<slug>`, checked even in dry-run so tests catch misuse.

import { GitHubError } from './errors.js';
import type { Logger } from './log.js';

export interface IssueSummary {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  html_url: string;
  updated_at: string;
  is_pull_request: boolean;
}

export interface PullSummary {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  html_url: string;
  head: { ref: string; sha: string };
  base: string;
  draft: boolean;
  updated_at: string;
}

/** Result of a write. `dryRun: true` means nothing was sent and `number`/`url` are fake. */
export interface WriteResult {
  dryRun: boolean;
  number: number;
  html_url: string;
}

export interface FileChange {
  path: string;
  /** New UTF-8 content, or null to delete the file. */
  content: string | null;
}

export interface OpenPullRequest {
  /** Must be `agent/<agent>/<slug>`. Created from `base` if missing. */
  branch: string;
  title: string;
  body: string;
  /** One commit containing all changes. */
  files: FileChange[];
  commitMessage?: string;
  base?: string;
  labels?: string[];
  draft?: boolean;
}

export interface CommitStatus {
  state: 'pending' | 'success' | 'failure' | 'error';
  context: string;
  description: string;
  target_url?: string;
}

/** The surface agents depend on. `MemoryGitHub` in testing.ts implements the same interface. */
export interface GitHubClient {
  readonly agent: string;
  readonly dryRun: boolean;
  listIssues(query?: {
    state?: 'open' | 'closed' | 'all';
    labels?: string[];
    limit?: number;
  }): Promise<IssueSummary[]>;
  listPulls(query?: {
    state?: 'open' | 'closed' | 'all';
    head?: string;
    limit?: number;
  }): Promise<PullSummary[]>;
  /** Search Issues/PRs; `repo:<owner>/<repo>` is added for you. */
  searchIssues(query: string, limit?: number): Promise<IssueSummary[]>;
  /** File content at `ref` (default branch when omitted), or null when missing. */
  getFile(path: string, ref?: string): Promise<string | null>;
  createIssue(issue: { title: string; body: string; labels?: string[] }): Promise<WriteResult>;
  /** Create or update this agent's single comment (found by `<!-- agent:<name> -->`). */
  upsertComment(issueNumber: number, body: string): Promise<WriteResult & { updated: boolean }>;
  addLabels(issueNumber: number, labels: string[]): Promise<WriteResult>;
  /** Commit files to an agent branch and open (or reuse) a PR. Never merges. */
  openPullRequest(pr: OpenPullRequest): Promise<WriteResult>;
  setCommitStatus(sha: string, status: CommitStatus): Promise<WriteResult>;
}

export interface GitHubOptions {
  agent: string;
  /** "owner/repo". */
  repository: string;
  token: string | undefined;
  dryRun: boolean;
  logger?: Logger;
  fetch?: typeof fetch;
  apiUrl?: string;
}

export function commentMarker(agent: string): string {
  return `<!-- agent:${agent} -->`;
}

/** Throws unless `branch` is `agent/<agent>/<slug>` with safe characters. */
export function assertAgentBranch(branch: string, agent: string): void {
  const prefix = `agent/${agent}/`;
  if (
    !branch.startsWith(prefix) ||
    !/^agent\/[a-z0-9-]+\/[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.includes('..')
  ) {
    throw new Error(`refusing to write to branch "${branch}": agents may only use ${prefix}<slug>`);
  }
}

function assertSafePath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.split('/').some((s) => s === '..' || s === '' || s === '.git')
  ) {
    throw new Error(`refusing unsafe file path "${path}"`);
  }
}

const FAKE = { dryRun: true, number: 0, html_url: 'dry-run' } as const;

interface RawIssue {
  number: number;
  title: string;
  body?: string | null;
  labels?: (string | { name?: string })[];
  state: string;
  html_url: string;
  updated_at: string;
  pull_request?: unknown;
}
interface RawPull extends RawIssue {
  head: { ref: string; sha: string };
  base: { ref: string };
  draft?: boolean;
}

function toIssue(r: RawIssue): IssueSummary {
  return {
    number: r.number,
    title: r.title,
    body: r.body ?? '',
    labels: (r.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
    state: r.state,
    html_url: r.html_url,
    updated_at: r.updated_at,
    is_pull_request: r.pull_request !== undefined,
  };
}

function toPull(r: RawPull): PullSummary {
  const i = toIssue(r);
  return {
    number: i.number,
    title: i.title,
    body: i.body,
    labels: i.labels,
    state: i.state,
    html_url: i.html_url,
    head: { ref: r.head.ref, sha: r.head.sha },
    base: r.base.ref,
    draft: r.draft ?? false,
    updated_at: i.updated_at,
  };
}

export class GitHub implements GitHubClient {
  readonly agent: string;
  readonly dryRun: boolean;
  private readonly repo: string;
  private readonly token: string | undefined;
  private readonly log: Logger | undefined;
  private readonly doFetch: typeof fetch;
  private readonly api: string;

  constructor(o: GitHubOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(o.repository))
      throw new Error('repository must be "owner/repo"');
    this.agent = o.agent;
    this.dryRun = o.dryRun;
    this.repo = o.repository;
    this.token = o.token;
    this.log = o.logger;
    this.doFetch = o.fetch ?? fetch;
    this.api = (o.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  }

  // ---------- transport ----------

  private async send(
    method: string,
    path: string,
    body?: unknown,
    allow404 = false,
  ): Promise<Response | null> {
    const res = await this.doFetch(`${this.api}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': `changelens-agent-${this.agent}`,
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      const detail = await res
        .json()
        .then((j: { message?: unknown }) =>
          typeof j.message === 'string' ? j.message.slice(0, 200) : '',
        )
        .catch(() => '');
      throw new GitHubError(res.status, method, path.split('?')[0] as string, detail);
    }
    return res;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = (await this.send(method, path, body)) as Response;
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private async requestOrNull<T>(path: string): Promise<T | null> {
    const res = await this.send('GET', path, undefined, true);
    return res ? ((await res.json()) as T) : null;
  }

  private repoPath(suffix: string): string {
    return `/repos/${this.repo}${suffix}`;
  }

  private async paged<T>(path: string, limit: number): Promise<T[]> {
    const out: T[] = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; out.length < limit; page++) {
      const batch = await this.request<T[]>('GET', `${path}${sep}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out.slice(0, limit);
  }

  /** In dry-run, log what would have happened and return a fake result. */
  private dry(action: string, summary: Record<string, unknown>): WriteResult | undefined {
    if (!this.dryRun) {
      if (!this.token) throw new Error('GITHUB_TOKEN is required when DRY_RUN=false');
      return undefined;
    }
    this.log?.info('github.dry-run', { action, ...summary });
    return { ...FAKE };
  }

  // ---------- reads ----------

  async listIssues(
    q: { state?: 'open' | 'closed' | 'all'; labels?: string[]; limit?: number } = {},
  ): Promise<IssueSummary[]> {
    const params = new URLSearchParams({ state: q.state ?? 'open' });
    if (q.labels?.length) params.set('labels', q.labels.join(','));
    const raw = await this.paged<RawIssue>(this.repoPath(`/issues?${params}`), q.limit ?? 100);
    return raw.map(toIssue).filter((i) => !i.is_pull_request);
  }

  async listPulls(
    q: { state?: 'open' | 'closed' | 'all'; head?: string; limit?: number } = {},
  ): Promise<PullSummary[]> {
    const params = new URLSearchParams({ state: q.state ?? 'open' });
    if (q.head) params.set('head', `${this.repo.split('/')[0]}:${q.head}`);
    const raw = await this.paged<RawPull>(this.repoPath(`/pulls?${params}`), q.limit ?? 100);
    return raw.map(toPull);
  }

  async searchIssues(query: string, limit = 100): Promise<IssueSummary[]> {
    const q = encodeURIComponent(`repo:${this.repo} ${query}`);
    const res = await this.request<{ items: RawIssue[] }>(
      'GET',
      `/search/issues?q=${q}&per_page=${Math.min(100, limit)}`,
    );
    return res.items.map(toIssue);
  }

  async getFile(path: string, ref?: string): Promise<string | null> {
    assertSafePath(path);
    const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const res = await this.requestOrNull<{ content?: string }>(
      this.repoPath(`/contents/${path.split('/').map(encodeURIComponent).join('/')}${suffix}`),
    );
    if (!res || typeof res.content !== 'string') return null;
    return Buffer.from(res.content, 'base64').toString('utf8');
  }

  // ---------- writes (dry-run aware) ----------

  async createIssue(issue: {
    title: string;
    body: string;
    labels?: string[];
  }): Promise<WriteResult> {
    const fake = this.dry('createIssue', { title: issue.title, labels: issue.labels ?? [] });
    if (fake) return fake;
    const r = await this.request<RawIssue>('POST', this.repoPath('/issues'), issue);
    return { dryRun: false, number: r.number, html_url: r.html_url };
  }

  async upsertComment(
    issueNumber: number,
    body: string,
  ): Promise<WriteResult & { updated: boolean }> {
    const marker = commentMarker(this.agent);
    const full = body.includes(marker) ? body : `${marker}\n${body}`;
    const comments = await this.paged<{ id: number; body?: string; html_url: string }>(
      this.repoPath(`/issues/${issueNumber}/comments`),
      500,
    );
    const mine = comments.find((c) => c.body?.includes(marker));
    const fake = this.dry('upsertComment', { issue: issueNumber, update: mine !== undefined });
    if (fake) return { ...fake, number: issueNumber, updated: mine !== undefined };
    const r = mine
      ? await this.request<{ html_url: string }>(
          'PATCH',
          this.repoPath(`/issues/comments/${mine.id}`),
          { body: full },
        )
      : await this.request<{ html_url: string }>(
          'POST',
          this.repoPath(`/issues/${issueNumber}/comments`),
          { body: full },
        );
    return {
      dryRun: false,
      number: issueNumber,
      html_url: r.html_url,
      updated: mine !== undefined,
    };
  }

  async addLabels(issueNumber: number, labels: string[]): Promise<WriteResult> {
    const fake = this.dry('addLabels', { issue: issueNumber, labels });
    if (fake) return { ...fake, number: issueNumber };
    await this.request('POST', this.repoPath(`/issues/${issueNumber}/labels`), { labels });
    return { dryRun: false, number: issueNumber, html_url: '' };
  }

  async openPullRequest(pr: OpenPullRequest): Promise<WriteResult> {
    assertAgentBranch(pr.branch, this.agent);
    const base = pr.base ?? 'main';
    if (pr.branch === base) throw new Error('branch and base must differ');
    if (pr.files.length === 0) throw new Error('openPullRequest needs at least one file');
    pr.files.forEach((f) => assertSafePath(f.path));
    const fake = this.dry('openPullRequest', {
      branch: pr.branch,
      base,
      title: pr.title,
      files: pr.files.map((f) => f.path),
    });
    if (fake) return fake;

    // One commit for all files via the git data API: ref → commit → tree → new commit → ref.
    type Ref = { object: { sha: string } };
    // GitHub reads a single ref at /ref/… and updates it at /refs/….
    const ref = (kind: 'ref' | 'refs', b: string) =>
      this.repoPath(`/git/${kind}/heads/${b.split('/').map(encodeURIComponent).join('/')}`);
    const existing = await this.requestOrNull<Ref>(ref('ref', pr.branch));
    const parent = existing ?? (await this.request<Ref>('GET', ref('ref', base)));
    const parentSha = parent.object.sha;
    const parentCommit = await this.request<{ tree: { sha: string } }>(
      'GET',
      this.repoPath(`/git/commits/${parentSha}`),
    );
    const tree = await this.request<{ sha: string }>('POST', this.repoPath('/git/trees'), {
      base_tree: parentCommit.tree.sha,
      tree: pr.files.map((f) => ({
        path: f.path,
        mode: '100644',
        type: 'blob',
        ...(f.content === null ? { sha: null } : { content: f.content }),
      })),
    });
    const commit = await this.request<{ sha: string }>('POST', this.repoPath('/git/commits'), {
      message: pr.commitMessage ?? pr.title,
      tree: tree.sha,
      parents: [parentSha],
    });
    if (existing) {
      await this.request('PATCH', ref('refs', pr.branch), { sha: commit.sha, force: false });
    } else {
      await this.request('POST', this.repoPath('/git/refs'), {
        ref: `refs/heads/${pr.branch}`,
        sha: commit.sha,
      });
    }

    const open = await this.listPulls({ state: 'open', head: pr.branch, limit: 1 });
    let number: number;
    let url: string;
    if (open[0]) {
      number = open[0].number;
      url = open[0].html_url;
    } else {
      const created = await this.request<{ number: number; html_url: string }>(
        'POST',
        this.repoPath('/pulls'),
        {
          title: pr.title,
          body: pr.body,
          head: pr.branch,
          base,
          draft: pr.draft ?? false,
        },
      );
      number = created.number;
      url = created.html_url;
    }
    if (pr.labels?.length) await this.addLabels(number, pr.labels);
    return { dryRun: false, number, html_url: url };
  }

  async setCommitStatus(sha: string, status: CommitStatus): Promise<WriteResult> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('setCommitStatus needs a full commit SHA');
    const fake = this.dry('setCommitStatus', { sha, state: status.state, context: status.context });
    if (fake) return fake;
    const r = await this.request<{ url: string }>(
      'POST',
      this.repoPath(`/statuses/${sha}`),
      status,
    );
    return { dryRun: false, number: 0, html_url: r.url };
  }
}
