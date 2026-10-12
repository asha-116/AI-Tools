#!/usr/bin/env node
// Waitlist progress (company/goals.md: ≥ 50 sign-ups to choose the first paid template).
// Counts sign-ups per idea and language in D1 `toolshop-waitlist` and prints a Markdown table.
// The query selects COUNT(*) only — never the email column — and every returned row is checked
// to hold nothing but an idea id, a language and a number, so no personal data can reach a log.
// Run by .github/workflows/waitlist-report.yml (counts go to the run summary, not to git).
//
// Usage: node scripts/waitlist-report.mjs
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WAITLIST_D1_ID (or it skips),
//      WRANGLER (default "npx --yes wrangler@4.143.0").
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { DEFAULT_WRANGLER, parseWranglerJson } from './backup.mjs';

export const WAITLIST_DB = 'toolshop-waitlist';
export const GOAL = 50;
export const COUNT_QUERY =
  'SELECT idea, lang, COUNT(*) AS n FROM signups GROUP BY idea, lang ORDER BY idea, lang';

/**
 * Keeps only {idea, lang, n} rows of the expected shape; anything else is refused.
 * @param {Record<string, unknown>[]} rows
 * @returns {{ idea: string, lang: 'en' | 'hi', n: number }[]}
 */
export function checkCountRows(rows) {
  return rows.map((row, i) => {
    const keys = Object.keys(row).sort().join(',');
    if (keys !== 'idea,lang,n') throw new Error(`row ${i}: unexpected columns (${keys})`);
    const { idea, lang, n } = row;
    if (typeof idea !== 'string' || !/^[a-z0-9-]{1,64}$/.test(idea)) {
      throw new Error(`row ${i}: idea is not an id`);
    }
    if (lang !== 'en' && lang !== 'hi') throw new Error(`row ${i}: lang is not en/hi`);
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      throw new Error(`row ${i}: count is not a whole number`);
    }
    return { idea, lang, n };
  });
}

/**
 * @param {{ idea: string, lang: 'en' | 'hi', n: number }[]} rows
 * @param {{ id: string, title: { en: string } }[]} ideas from data/waitlist-ideas.json
 * @param {string} date YYYY-MM-DD
 */
export function reportMarkdown(rows, ideas, date) {
  /** @type {Map<string, { en: number, hi: number }>} */
  const by = new Map(ideas.map((i) => [i.id, { en: 0, hi: 0 }]));
  for (const r of rows) {
    const c = by.get(r.idea) ?? { en: 0, hi: 0 };
    c[r.lang] += r.n;
    by.set(r.idea, c);
  }
  const title = (id) =>
    ideas.find((i) => i.id === id)?.title.en ?? `${id} (not in waitlist-ideas.json)`;
  const total = [...by.values()].reduce((s, c) => s + c.en + c.hi, 0);
  const lines = [
    `### Waitlist sign-ups — ${date}`,
    '',
    `**${total} of ${GOAL}** (goal in company/goals.md)${total >= GOAL ? ' — goal reached' : ''}.`,
    '',
    '| Idea | English | Hindi | Total |',
    '| --- | ---: | ---: | ---: |',
  ];
  const sorted = [...by.entries()].sort((a, b) => b[1].en + b[1].hi - (a[1].en + a[1].hi));
  for (const [id, c] of sorted) {
    lines.push(`| ${title(id)} | ${c.en} | ${c.hi} | ${c.en + c.hi} |`);
  }
  lines.push('', '_Counts only; no email address is read by this report._', '');
  return lines.join('\n');
}

/** @param {string} databaseId */
export function wranglerConfig(databaseId) {
  if (!/^[0-9a-f-]{36}$/i.test(databaseId)) throw new Error('WAITLIST_D1_ID must be a UUID');
  return [
    'name = "toolshop-waitlist-report"',
    'compatibility_date = "2026-09-01"',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = "${WAITLIST_DB}"`,
    `database_id = "${databaseId}"`,
    '',
  ].join('\n');
}

/** @param {Record<string, string | undefined>} env */
export function missingCloudflare(env) {
  return ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'WAITLIST_D1_ID'].filter((k) => !env[k]);
}

/* c8 ignore start — process wiring (wrangler); the pieces above are unit-tested */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = process.env;
  const missing = missingCloudflare(env);
  if (missing.length) {
    console.log(`::notice::Skipping the waitlist report; not configured: ${missing.join(' ')}`);
    process.exit(0);
  }
  const ideas = JSON.parse(
    readFileSync(new URL('../data/waitlist-ideas.json', import.meta.url), 'utf8'),
  ).ideas;
  const tmp = await mkdtemp(join(tmpdir(), 'waitlist-'));
  try {
    const config = join(tmp, 'wrangler.toml');
    await writeFile(config, wranglerConfig(String(env.WAITLIST_D1_ID)));
    const [cmd, ...pre] = (env.WRANGLER || DEFAULT_WRANGLER).split(/\s+/).filter(Boolean);
    const { stdout } = await promisify(execFile)(
      cmd,
      [
        ...pre,
        'd1',
        'execute',
        WAITLIST_DB,
        '--remote',
        '--json',
        '--config',
        config,
        '--command',
        COUNT_QUERY,
      ],
      { maxBuffer: 8 * 1024 * 1024, cwd: tmp },
    );
    const rows = checkCountRows(parseWranglerJson(stdout));
    console.log(reportMarkdown(rows, ideas, new Date().toISOString().slice(0, 10)));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
/* c8 ignore stop */
