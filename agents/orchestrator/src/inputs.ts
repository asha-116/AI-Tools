// Inputs read from the checked-out repository (PROCEDURE "Inputs"): data/** freshness, the last
// daily reports, the latest memory file and local agent logs. Repo metadata only — no customer
// data lives in these paths.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defaultLogDir, tokensUsedInLog } from '../../lib/src/index.js';
import { lastVerifiedDates, type DataFile } from './state.js';

function walk(dir: string, depth = 0): string[] {
  if (depth > 8 || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, depth + 1));
    else out.push(full);
  }
  return out;
}

const posix = (p: string) => p.split(sep).join('/');

/** Every `data/**.json` file with its `last_verified` dates (files without any are skipped). */
export function readDataFiles(repoRoot: string): { files: DataFile[]; unreadable: string[] } {
  const files: DataFile[] = [];
  const unreadable: string[] = [];
  for (const full of walk(join(repoRoot, 'data'))) {
    if (!full.endsWith('.json')) continue;
    const path = posix(relative(repoRoot, full));
    try {
      const dates = lastVerifiedDates(JSON.parse(readFileSync(full, 'utf8')));
      if (dates.length) files.push({ path, dates });
    } catch {
      unreadable.push(path);
    }
  }
  return { files, unreadable };
}

/** Text clipped to `max` characters with a marker. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 12))}\n…[clipped]`;
}

export interface ReportFile {
  date: string;
  text: string;
}

/** Up to `count` daily reports dated before `today`, newest first, each clipped. */
export function readRecentReports(
  repoRoot: string,
  today: string,
  count = 7,
  maxChars = 1200,
): ReportFile[] {
  const dir = join(repoRoot, 'company', 'reports', 'daily');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => /^(\d{4}-\d{2}-\d{2})\.md$/.exec(f)?.[1])
    .filter((d): d is string => d !== undefined && d < today)
    .sort()
    .reverse()
    .slice(0, count)
    .map((date) => ({
      date,
      text: clip(readFileSync(join(dir, `${date}.md`), 'utf8'), maxChars),
    }));
}

/** The newest `company/memory/YYYY-MM.md`, clipped; null when there is none. */
export function readLatestMemory(
  repoRoot: string,
  maxChars = 2000,
): { file: string; text: string } | null {
  const dir = join(repoRoot, 'company', 'memory');
  if (!existsSync(dir)) return null;
  const latest = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.md$/.test(f))
    .sort()
    .pop();
  if (!latest) return null;
  return {
    file: `company/memory/${latest}`,
    text: clip(readFileSync(join(dir, latest), 'utf8'), maxChars),
  };
}

/** LLM tokens per agent on `date`, from local run logs (`run.end` lines). */
export function readTokenUsage(
  repoRoot: string,
  date: string,
): { agent: string; tokens: number }[] {
  const dir = defaultLogDir(repoRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((a) => statSync(join(dir, a)).isDirectory())
    .sort()
    .map((agent) => ({ agent, tokens: tokensUsedInLog(join(dir, agent, `${date}.jsonl`)) }))
    .filter((u) => u.tokens > 0);
}

/** The newest `company/reports/usage/YYYY-MM.md` path, or null. */
export function latestUsageReport(repoRoot: string): string | null {
  const dir = join(repoRoot, 'company', 'reports', 'usage');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir)
    .filter((n) => /^\d{4}-\d{2}\.md$/.test(n))
    .sort()
    .pop();
  return f ? `company/reports/usage/${f}` : null;
}
