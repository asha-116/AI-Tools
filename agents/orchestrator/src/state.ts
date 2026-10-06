// PROCEDURE step 1: deterministic state checks. Pure functions — no IO, no clock.

import type { IssueSummary, PullSummary } from '../../lib/src/index.js';

export const DAY_MS = 86_400_000;
export const STALE_ISSUE_DAYS = 7;
export const OWNER_REVIEW_DAYS = 2;
export const STALE_DATA_DAYS = 180;
export const NEEDS_OWNER = 'needs-owner';

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Calendar date (YYYY-MM-DD) in India Standard Time. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `date` (YYYY-MM-DD) plus `days`. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `iso` to `now` (floor); null when `iso` is not a date. */
export function ageDays(iso: string, now: Date): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / DAY_MS);
}

export interface Aged<T> {
  item: T;
  days: number;
}

/** Open Issues with no activity for more than `days` days, oldest first. */
export function staleIssues(
  issues: readonly IssueSummary[],
  now: Date,
  days = STALE_ISSUE_DAYS,
): Aged<IssueSummary>[] {
  return issues
    .filter((i) => i.state === 'open' && !i.is_pull_request)
    .map((item) => ({ item, days: ageDays(item.updated_at, now) ?? 0 }))
    .filter((a) => a.days > days)
    .sort((a, b) => b.days - a.days || a.item.number - b.item.number);
}

export interface WaitingPull {
  number: number;
  title: string;
  html_url: string;
  reason: 'needs-owner' | 'no-review';
  days: number;
}

/**
 * PRs waiting on the owner: open PRs labelled `needs-owner`, plus open PRs with no review
 * (`unreviewed`, from the search `is:pr is:open review:none`) idle for more than `days` days.
 */
export function prsWaitingOnOwner(
  pulls: readonly PullSummary[],
  unreviewed: readonly IssueSummary[],
  now: Date,
  days = OWNER_REVIEW_DAYS,
): WaitingPull[] {
  const out = new Map<number, WaitingPull>();
  for (const p of pulls) {
    if (p.state !== 'open' || !p.labels.includes(NEEDS_OWNER)) continue;
    out.set(p.number, {
      number: p.number,
      title: p.title,
      html_url: p.html_url,
      reason: 'needs-owner',
      days: ageDays(p.updated_at, now) ?? 0,
    });
  }
  for (const p of unreviewed) {
    const age = ageDays(p.updated_at, now) ?? 0;
    if (p.state !== 'open' || out.has(p.number) || age <= days) continue;
    out.set(p.number, {
      number: p.number,
      title: p.title,
      html_url: p.html_url,
      reason: 'no-review',
      days: age,
    });
  }
  return [...out.values()].sort((a, b) => b.days - a.days || a.number - b.number);
}

/** Open Issues the owner has to answer. */
export function ownerIssues(issues: readonly IssueSummary[]): IssueSummary[] {
  return issues.filter((i) => i.state === 'open' && i.labels.includes(NEEDS_OWNER));
}

/** The fields of a GitHub Actions workflow run the Orchestrator uses. */
export interface WorkflowRun {
  name: string;
  path: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
}

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

/** Workflows whose most recent completed run failed (one entry per workflow file). */
export function failingWorkflows(runs: readonly WorkflowRun[]): WorkflowRun[] {
  const latest = new Map<string, WorkflowRun>();
  for (const r of runs) {
    if (r.status !== 'completed') continue;
    const key = r.path || r.name;
    const seen = latest.get(key);
    if (!seen || Date.parse(r.created_at) > Date.parse(seen.created_at)) latest.set(key, r);
  }
  return [...latest.values()]
    .filter((r) => r.conclusion !== null && FAILED.has(r.conclusion))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every `last_verified` string anywhere in a parsed JSON document. */
export function lastVerifiedDates(doc: unknown, depth = 0): string[] {
  if (depth > 20 || doc === null || typeof doc !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'last_verified' && typeof v === 'string') out.push(v);
    else out.push(...lastVerifiedDates(v, depth + 1));
  }
  return out;
}

export interface DataFile {
  path: string;
  /** All `last_verified` values in the file. */
  dates: string[];
}

export interface StaleData {
  path: string;
  /** Oldest `last_verified` in the file (or the unparsable value). */
  last_verified: string;
  /** null when the date cannot be parsed (treated as stale). */
  days: number | null;
}

/** Data files whose oldest `last_verified` is more than `days` days old (or unparsable). */
export function staleDataFiles(
  files: readonly DataFile[],
  now: Date,
  days = STALE_DATA_DAYS,
): StaleData[] {
  const out: StaleData[] = [];
  for (const f of files) {
    let worst: StaleData | undefined;
    for (const d of f.dates) {
      const age = /^\d{4}-\d{2}-\d{2}$/.test(d) ? ageDays(`${d}T00:00:00Z`, now) : null;
      const cand: StaleData = { path: f.path, last_verified: d, days: age };
      if (age === null) {
        worst = cand;
        break;
      }
      if (!worst || (worst.days !== null && age > worst.days)) worst = cand;
    }
    if (worst && (worst.days === null || worst.days > days)) out.push(worst);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** True when goals.md has no bullet under any heading (only the template text). */
export function goalsAreEmpty(markdown: string): boolean {
  return !markdown
    .split('\n')
    .some((l) => /^\s*[-*]\s+\S/.test(l) && !/^\s*[-*]\s+(?:tbd|todo|…|\.\.\.)\s*$/i.test(l));
}
