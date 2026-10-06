// Network collectors for the usage monitor. `fetch` is always injected; each collector returns
// { measurements, notCollected } and never throws for a missing token or a failed query, so
// one broken source never hides the others.
import { createGitHub } from '../../lib/github.mjs';
import { jobBilledMinutes, peakDay } from './core.mjs';

/**
 * @typedef {import('./core.mjs').Measurement} Measurement
 * @typedef {import('./core.mjs').Period} Period
 * @typedef {import('../../lib/github.mjs').FetchLike} FetchLike
 * @typedef {{ measurements: Measurement[], notCollected: Record<string, string> }} Collected
 */

export const GITHUB_IDS = ['github-actions-minutes'];
export const CLOUDFLARE_IDS = [
  'workers-requests',
  'd1-rows-read',
  'd1-rows-written',
  'd1-storage',
  'r2-storage',
  'r2-class-a',
  'r2-class-b',
];

/** @param {string[]} ids @param {string} reason @returns {Collected} */
function skipped(ids, reason) {
  return { measurements: [], notCollected: Object.fromEntries(ids.map((id) => [id, reason])) };
}

/** @param {unknown} e */
const message = (e) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * Runs `fn` over `items` with at most `limit` in flight.
 * @template T, R
 * @param {T[]} items @param {number} limit @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, fn) {
  /** @type {R[]} */
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * GitHub Actions minutes: lists the repo's workflow runs created in the period and sums each
 * job's billed minutes (rounded up per job, like GitHub's billing). Works with the workflow's
 * GITHUB_TOKEN (actions: read) — the billing API would need an owner token.
 * @param {{ fetch: FetchLike, token?: string, repo?: string, period: Period,
 *   multipliers: Record<string, number> }} opts
 * @returns {Promise<Collected>}
 */
export async function collectGitHubActions({ fetch, token, repo, period, multipliers }) {
  if (!token || !repo)
    return skipped(GITHUB_IDS, 'not configured (GITHUB_TOKEN / GITHUB_REPOSITORY)');
  try {
    const gh = createGitHub({ token, fetch });
    const info = await gh.request('GET', `/repos/${repo}`);
    const runs = await gh.paginate(
      `/repos/${repo}/actions/runs?created=${period.start}..${period.end}`,
      (p) => p.workflow_runs,
    );
    const perRun = await mapLimit(runs, 6, async (run) => {
      const jobs = await gh.paginate(
        `/repos/${repo}/actions/runs/${run.id}/jobs?filter=all`,
        (p) => p.jobs,
        3,
      );
      return jobs.reduce((sum, job) => sum + jobBilledMinutes(job, multipliers), 0);
    });
    const minutes = perRun.reduce((a, b) => a + b, 0);
    /** @type {Measurement} */
    const m = {
      id: 'github-actions-minutes',
      value: minutes,
      detail: `${runs.length} runs${runs.length >= 1000 ? ' (API cap reached — undercount)' : ''}`,
    };
    if (info?.private === false) m.unlimited = 'public repo: standard runners are free';
    return { measurements: [m], notCollected: {} };
  } catch (e) {
    return {
      measurements: [{ id: 'github-actions-minutes', error: message(e) }],
      notCollected: {},
    };
  }
}

export const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

/** GraphQL queries, one per dataset so a missing permission/dataset fails only its rows. */
export const CF_QUERIES = {
  workers: `query ($a: String!, $s: Date!, $e: Date!) { viewer { accounts(filter: {accountTag: $a}) {
    workersInvocationsAdaptive(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { sum { requests } dimensions { date } } } } }`,
  d1: `query ($a: String!, $s: Date!, $e: Date!) { viewer { accounts(filter: {accountTag: $a}) {
    d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { sum { rowsRead rowsWritten } dimensions { date } } } } }`,
  d1Storage: `query ($a: String!, $s: Date!, $e: Date!) { viewer { accounts(filter: {accountTag: $a}) {
    d1StorageAdaptiveGroups(limit: 10000, filter: {date_geq: $s, date_leq: $e}) { max { databaseSizeBytes } dimensions { databaseId } } } } }`,
  r2Storage: `query ($a: String!, $st: Time!, $et: Time!) { viewer { accounts(filter: {accountTag: $a}) {
    r2StorageAdaptiveGroups(limit: 10000, filter: {datetime_geq: $st, datetime_leq: $et}) { max { payloadSize metadataSize } dimensions { bucketName } } } } }`,
  r2Ops: `query ($a: String!, $st: Time!, $et: Time!) { viewer { accounts(filter: {accountTag: $a}) {
    r2OperationsAdaptiveGroups(limit: 10000, filter: {datetime_geq: $st, datetime_leq: $et}) { sum { requests } dimensions { actionType } } } } }`,
};

const GB = 1e9; // Cloudflare bills storage in decimal GB.

/**
 * Pure: turns the five GraphQL results into measurements. A result is either the
 * `accounts[0]` object or `{ error }`.
 * @param {Record<keyof typeof CF_QUERIES, any>} results
 * @param {{ a: string[], b: string[] }} r2Classes
 * @returns {Measurement[]}
 */
export function cloudflareMeasurements(results, r2Classes) {
  /** @type {Measurement[]} */
  const out = [];
  /** @param {string} id @param {any} r @param {() => Omit<Measurement, 'id'>} f */
  const add = (id, r, f) => {
    if (r?.error) out.push({ id, error: r.error });
    else {
      try {
        out.push({ id, ...f() });
      } catch (e) {
        out.push({ id, error: `unexpected response: ${message(e)}` });
      }
    }
  };
  /** @param {any[]} groups @param {(g: any) => number} get */
  const daily = (groups, get) => {
    const p = peakDay(groups.map((g) => ({ date: g.dimensions.date, value: Number(get(g)) || 0 })));
    return { value: p.value, peakDate: p.date, detail: `${p.days} day(s) with data` };
  };
  const w = results.workers;
  add('workers-requests', w, () => daily(w.workersInvocationsAdaptive, (g) => g.sum.requests));
  const d = results.d1;
  add('d1-rows-read', d, () => daily(d.d1AnalyticsAdaptiveGroups, (g) => g.sum.rowsRead));
  add('d1-rows-written', d, () => daily(d.d1AnalyticsAdaptiveGroups, (g) => g.sum.rowsWritten));
  const ds = results.d1Storage;
  add('d1-storage', ds, () => {
    const groups = ds.d1StorageAdaptiveGroups;
    const bytes = groups.reduce((s, g) => s + (Number(g.max.databaseSizeBytes) || 0), 0);
    return { value: bytes / GB, detail: `${groups.length} database(s)` };
  });
  const rs = results.r2Storage;
  add('r2-storage', rs, () => {
    const groups = rs.r2StorageAdaptiveGroups;
    const bytes = groups.reduce(
      (s, g) => s + (Number(g.max.payloadSize) || 0) + (Number(g.max.metadataSize) || 0),
      0,
    );
    return { value: bytes / GB, detail: `${groups.length} bucket(s)` };
  });
  const ro = results.r2Ops;
  /** @param {string[]} cls */
  const ops = (cls) =>
    ro.r2OperationsAdaptiveGroups
      .filter((g) => cls.includes(g.dimensions.actionType))
      .reduce((s, g) => s + (Number(g.sum.requests) || 0), 0);
  add('r2-class-a', ro, () => ({ value: ops(r2Classes.a) }));
  add('r2-class-b', ro, () => ({ value: ops(r2Classes.b) }));
  return out;
}

/**
 * Cloudflare usage via the GraphQL Analytics API. The API token needs
 * "Account · Account Analytics · Read" in addition to the deploy permissions.
 * @param {{ fetch: FetchLike, token?: string, accountId?: string, period: Period,
 *   r2Classes: { a: string[], b: string[] } }} opts
 * @returns {Promise<Collected>}
 */
export async function collectCloudflare({ fetch, token, accountId, period, r2Classes }) {
  if (!token || !accountId) {
    return skipped(CLOUDFLARE_IDS, 'not configured (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)');
  }
  const variables = {
    a: accountId,
    s: period.start,
    e: period.end,
    st: period.startTime,
    et: period.endTime,
  };
  /** @param {string} query */
  const run = async (query) => {
    try {
      const res = await fetch(CF_GRAPHQL, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) return { error: `HTTP ${res.status}` };
      if (Array.isArray(json.errors) && json.errors.length) {
        return {
          error: json.errors
            .map((/** @type {any} */ x) => x?.message)
            .join('; ')
            .slice(0, 200),
        };
      }
      const account = json.data?.viewer?.accounts?.[0];
      return account ?? { error: 'account not found (check CLOUDFLARE_ACCOUNT_ID / token scope)' };
    } catch (e) {
      return { error: message(e) };
    }
  };
  const keys = /** @type {(keyof typeof CF_QUERIES)[]} */ (Object.keys(CF_QUERIES));
  const answers = await Promise.all(keys.map((k) => run(CF_QUERIES[k])));
  const results = /** @type {Record<keyof typeof CF_QUERIES, any>} */ (
    Object.fromEntries(keys.map((k, i) => [k, answers[i]]))
  );
  return { measurements: cloudflareMeasurements(results, r2Classes), notCollected: {} };
}
