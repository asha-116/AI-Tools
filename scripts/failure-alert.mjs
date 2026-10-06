#!/usr/bin/env node
// Opens (or comments on) one Issue per failing workflow. Called by
// .github/workflows/failure-alert.yml with details of the failed run in env vars.
// Usage: node scripts/failure-alert.mjs [--dry-run]
import { pathToFileURL } from 'node:url';
import { createGitHub, markerFor, upsertMarkedIssue } from './lib/github.mjs';

export const FAILURE_LABELS = ['type:bug', 'needs-owner', 'type:alert'];

/**
 * @typedef {{ workflow: string, runUrl: string, runNumber?: string, attempt?: string,
 *   branch?: string, event?: string, sha?: string, conclusion?: string }} FailedRun
 */

/**
 * Reads the failed run from the environment set by the workflow. Missing values become ''.
 * @param {Record<string, string | undefined>} env
 * @returns {FailedRun}
 */
export function readFailedRun(env) {
  return {
    workflow: env.FAILED_WORKFLOW ?? '',
    runUrl: env.FAILED_RUN_URL ?? '',
    runNumber: env.FAILED_RUN_NUMBER ?? '',
    attempt: env.FAILED_RUN_ATTEMPT ?? '',
    branch: env.FAILED_BRANCH ?? '',
    event: env.FAILED_EVENT ?? '',
    sha: env.FAILED_SHA ?? '',
    conclusion: env.FAILED_CONCLUSION ?? 'failure',
  };
}

/** Keeps user-controlled text from breaking the Markdown table/inline code. */
function clean(/** @type {string | undefined} */ s) {
  return String(s ?? '')
    .replace(/[`|\r\n<>]/g, ' ')
    .trim();
}

/**
 * @param {FailedRun} run
 * @param {Date} [now]
 */
export function buildFailureAlert(run, now = new Date()) {
  const workflow = clean(run.workflow) || 'unknown workflow';
  if (!/^https:\/\/[^\s)]+$/.test(run.runUrl)) throw new Error('FAILED_RUN_URL must be https');
  const marker = markerFor(`workflow-failure:${workflow}`);
  const when = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const sha = clean(run.sha).slice(0, 7);
  const attempt = clean(run.attempt);
  const runLabel = `run #${clean(run.runNumber) || '?'}${attempt && attempt !== '1' ? ` (attempt ${attempt})` : ''}`;
  const details = [
    `| Workflow | ${workflow} |`,
    `| Run | [${runLabel}](${run.runUrl}) |`,
    `| Result | ${clean(run.conclusion) || 'failure'} |`,
    `| Trigger | ${clean(run.event) || '?'} on \`${clean(run.branch) || '?'}\` at \`${sha || '?'}\` |`,
    `| Detected | ${when} |`,
  ];
  const body = [
    marker,
    `The **${workflow}** workflow failed on the default branch (or a scheduled run).`,
    '',
    '| | |',
    '| --- | --- |',
    ...details,
    '',
    '### What to do',
    '',
    '1. Open the run link above and read the first red step.',
    '2. If it was a one-off (network, provider outage), press **Re-run failed jobs**.',
    '3. Otherwise fix it in a PR, or ask a coding session to (paste this Issue).',
    '4. Close this Issue once the next run is green. Later failures of the same workflow are',
    '   added here as comments while it is open; after closing, a new failure opens a new Issue.',
    '',
    '_Opened automatically by `.github/workflows/failure-alert.yml`._',
  ].join('\n');
  const comment = [
    `Failed again: [${runLabel}](${run.runUrl}) — ${clean(run.event) || '?'} on \`${clean(run.branch) || '?'}\` at \`${sha || '?'}\`, ${when}.`,
  ].join('\n');
  return { marker, title: `Workflow failed: ${workflow}`, body, comment, labels: FAILURE_LABELS };
}

/* c8 ignore start — thin CLI wrapper around tested functions */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const token = process.env.GITHUB_TOKEN ?? '';
  const alert = buildFailureAlert(readFailedRun(process.env));
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const gh = createGitHub({ token });
  const res = await upsertMarkedIssue(gh, { repo, ...alert, dryRun, log: console.log });
  console.log(JSON.stringify(res));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
/* c8 ignore stop */
