#!/usr/bin/env node
// Free-tier usage monitor (Phase 6). Collects usage, writes company/reports/usage/<YYYY-MM>.md
// and, with --alert, opens/updates one `needs-owner` Issue when anything is ≥ the threshold.
//
// Usage: node scripts/usage/src/main.mjs [--month previous|current|YYYY-MM]
//          [--out-dir company/reports/usage] [--alert] [--dry-run]
// Env (each optional; a missing one skips its collector):
//   GITHUB_TOKEN + GITHUB_REPOSITORY            Actions minutes, and the alert Issue
//   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID Workers/D1/R2 (token needs Account Analytics: Read)
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createGitHub, markerFor, upsertMarkedIssue } from '../../lib/github.mjs';
import { collectCloudflare, collectGitHubActions } from './collectors.mjs';
import {
  USAGE_ALERT_KEY,
  buildUsageAlert,
  evaluate,
  formatReport,
  parseLimits,
  resolvePeriod,
} from './core.mjs';
import { collectLlmTokens } from './llm-logs.mjs';

const root = new URL('../../../', import.meta.url).pathname;

/**
 * @param {{ argv: string[], env: Record<string, string | undefined>, fetch: import('../../lib/github.mjs').FetchLike,
 *   now: Date, root: string, log: (m: string) => void }} ctx
 */
export async function run({ argv, env, fetch, now, root: base, log }) {
  const { values } = parseArgs({
    args: argv,
    options: {
      month: { type: 'string', default: 'previous' },
      'out-dir': { type: 'string', default: 'company/reports/usage' },
      alert: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const config = parseLimits(
    JSON.parse(await readFile(join(base, 'data/free-tier-limits.json'), 'utf8')),
  );
  const period = resolvePeriod(values.month, now);
  const repo = env.GITHUB_REPOSITORY;
  const runUrl =
    env.GITHUB_RUN_ID && repo
      ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined;

  const [gh, cf, llm] = await Promise.all([
    collectGitHubActions({
      fetch,
      token: env.GITHUB_TOKEN,
      repo,
      period,
      multipliers: config.runnerMultipliers,
    }),
    collectCloudflare({
      fetch,
      token: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      period,
      r2Classes: config.r2Classes,
    }),
    collectLlmTokens(join(base, 'company/reports/agent-logs'), period.month),
  ]);
  const rows = evaluate(config, [...gh.measurements, ...cf.measurements], {
    ...gh.notCollected,
    ...cf.notCollected,
  });
  const report = formatReport({
    period,
    rows,
    threshold: config.threshold,
    llm,
    llmNote:
      llm.files === 0 ? 'No agent logs yet (`company/reports/agent-logs/` is empty).' : undefined,
    generatedAt: now,
    runUrl,
  });
  const outDir = resolve(base, values['out-dir']);
  await mkdir(outDir, { recursive: true });
  const reportPath = join(values['out-dir'], `${period.month}.md`);
  await writeFile(resolve(base, reportPath), report);
  log(`Wrote ${reportPath}`);
  for (const r of rows) {
    if (r.status === 'error') log(`::warning::${r.service} ${r.metric}: ${r.detail}`);
  }

  const alert = buildUsageAlert({ period, rows, threshold: config.threshold, reportPath, runUrl });
  if (alert) log(`::warning::${alert.title}`);
  let issue = null;
  if (alert && values.alert) {
    if (!env.GITHUB_TOKEN || !repo) {
      log('::warning::Cannot open the alert Issue: GITHUB_TOKEN / GITHUB_REPOSITORY not set');
    } else {
      issue = await upsertMarkedIssue(createGitHub({ token: env.GITHUB_TOKEN, fetch }), {
        repo,
        marker: markerFor(USAGE_ALERT_KEY),
        ...alert,
        replaceBody: true,
        dryRun: values['dry-run'],
        log,
      });
    }
  }
  if (env.GITHUB_OUTPUT) {
    await appendFile(
      env.GITHUB_OUTPUT,
      `month=${period.month}\nreport=${reportPath}\nalert=${alert ? 'true' : 'false'}\n`,
    );
  }
  return { period, rows, report, reportPath, alert, issue };
}

/* c8 ignore start — process wiring */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run({
    argv: process.argv.slice(2),
    env: process.env,
    fetch: globalThis.fetch,
    now: new Date(),
    root,
    log: console.log,
  }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
/* c8 ignore stop */
