// Minimal GitHub REST helpers shared by the Phase 6 scripts (usage monitor, failure alerts).
// `fetch` is injected so the logic is testable without network. Zero dependencies.

/**
 * @typedef {(url: string, init?: RequestInit) => Promise<Response>} FetchLike
 * @typedef {{ number: number, html_url: string, body?: string | null, pull_request?: unknown }} Issue
 * @typedef {{
 *   request: (method: string, path: string, body?: unknown) => Promise<any>,
 *   paginate: (path: string, pick?: (page: any) => any[], maxPages?: number) => Promise<any[]>,
 * }} GitHubClient
 */

/**
 * @param {{ token: string, fetch?: FetchLike, apiUrl?: string }} opts
 * @returns {GitHubClient}
 */
export function createGitHub({
  token,
  fetch: f = globalThis.fetch,
  apiUrl = 'https://api.github.com',
}) {
  if (!token) throw new Error('GitHub token missing');
  /** @type {GitHubClient['request']} */
  const request = async (method, path, body) => {
    const res = await f(`${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'toolshop-ops-scripts',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : null;
  };
  /** @type {GitHubClient['paginate']} */
  const paginate = async (path, pick = (p) => p, maxPages = 10) => {
    const out = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= maxPages; page++) {
      const items = pick(await request('GET', `${path}${sep}per_page=100&page=${page}`)) ?? [];
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  };
  return { request, paginate };
}

/**
 * Hidden HTML comment that identifies an automated Issue, so reruns update it instead of
 * opening duplicates. The key is reduced to a safe charset so it cannot close the comment.
 * @param {string} key
 */
export function markerFor(key) {
  const safe =
    String(key)
      .toLowerCase()
      .replace(/[^a-z0-9._:/ -]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .slice(0, 100) || 'unnamed';
  return `<!-- toolshop-alert:${safe} -->`;
}

/**
 * @param {Issue[]} issues
 * @param {string} marker
 * @returns {Issue | undefined}
 */
export function findMarkedIssue(issues, marker) {
  return issues.find(
    (i) => !i.pull_request && typeof i.body === 'string' && i.body.includes(marker),
  );
}

/**
 * Opens an Issue carrying `marker`, or — when an open one already exists — adds `comment` to
 * it (and replaces its body when `replaceBody` is set). Never closes or deletes anything.
 * @param {GitHubClient} gh
 * @param {{ repo: string, marker: string, title: string, body: string, comment: string,
 *   labels: string[], replaceBody?: boolean, dryRun?: boolean, log?: (msg: string) => void }} opts
 * @returns {Promise<{ action: 'created' | 'commented' | 'dry-run', number?: number, url?: string }>}
 */
export async function upsertMarkedIssue(gh, opts) {
  const { repo, marker, title, comment, labels, replaceBody = false, dryRun = false } = opts;
  const log = opts.log ?? (() => {});
  const body = opts.body.includes(marker) ? opts.body : `${marker}\n${opts.body}`;
  const open = await gh.paginate(`/repos/${repo}/issues?state=open`);
  const existing = findMarkedIssue(open, marker);
  if (dryRun) {
    log(
      existing
        ? `[dry-run] would comment on #${existing.number}:\n${comment}`
        : `[dry-run] would open "${title}" [${labels.join(', ')}]:\n${body}`,
    );
    return { action: 'dry-run', number: existing?.number };
  }
  if (existing) {
    if (replaceBody) {
      await gh.request('PATCH', `/repos/${repo}/issues/${existing.number}`, { body });
    }
    await gh.request('POST', `/repos/${repo}/issues/${existing.number}/comments`, {
      body: comment,
    });
    log(`Commented on #${existing.number}`);
    return { action: 'commented', number: existing.number, url: existing.html_url };
  }
  const created = await gh.request('POST', `/repos/${repo}/issues`, { title, body, labels });
  log(`Opened #${created.number}`);
  return { action: 'created', number: created.number, url: created.html_url };
}
