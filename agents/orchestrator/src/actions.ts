// Read-only GitHub Actions client (the shared lib GitHub client has no Actions endpoint yet).
// Lists recent completed workflow runs on the default branch.

import { GitHubError } from '../../lib/src/index.js';
import type { WorkflowRun } from './state.js';

export interface ActionsOptions {
  repository: string;
  token: string | undefined;
  fetch?: typeof fetch;
  apiUrl?: string;
}

interface RawRun {
  name?: string | null;
  path?: string | null;
  status?: string | null;
  conclusion?: string | null;
  html_url?: string;
  created_at?: string;
}

/** Completed runs on `branch` created on or after `since` (YYYY-MM-DD), newest first, ≤ 100. */
export async function listWorkflowRuns(
  o: ActionsOptions,
  since: string,
  branch = 'main',
): Promise<WorkflowRun[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(o.repository)) throw new Error('repository must be "owner/repo"');
  const api = (o.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const params = new URLSearchParams({
    branch,
    status: 'completed',
    created: `>=${since}`,
    exclude_pull_requests: 'true',
    per_page: '100',
  });
  const path = `/repos/${o.repository}/actions/runs`;
  const res = await (o.fetch ?? fetch)(`${api}${path}?${params}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'changelens-agent-orchestrator',
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
    },
  });
  if (!res.ok) throw new GitHubError(res.status, 'GET', path, '');
  const body = (await res.json()) as { workflow_runs?: RawRun[] };
  return (body.workflow_runs ?? []).map((r) => ({
    name: r.name ?? r.path ?? 'unnamed workflow',
    path: r.path ?? '',
    status: r.status ?? 'unknown',
    conclusion: r.conclusion ?? null,
    html_url: r.html_url ?? '',
    created_at: r.created_at ?? '',
  }));
}
