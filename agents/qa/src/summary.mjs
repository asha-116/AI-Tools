// QA PR summary (agents/qa/PROCEDURE.md step 8): one comment per PR, updated in place.
// Plain JavaScript so actions/github-script can import it without a build step;
// types are in summary.d.mts, tests in agents/qa/test/summary.test.ts.

export const MARKER = '<!-- agent:qa -->';

/** Steps of the `checks` job in .github/workflows/ci.yml, by step id (= job output name). */
const CHECK_STEPS = [
  ['install', 'Install'],
  ['lint', 'Lint'],
  ['format', 'Format'],
  ['typecheck', 'Typecheck'],
  ['site_check', 'Astro check'],
  ['bilingual', 'Bilingual strings'],
  ['tests', 'Unit tests + coverage'],
  ['build', 'Build site'],
  ['pages', 'Pages: disclaimer, formula, templates'],
  ['structure', 'Repo structure'],
];

/** Other jobs in ci.yml, reported by job result. */
const JOBS = [
  ['lighthouse', 'Lighthouse (mobile ≥ 90)'],
  ['secrets', 'Secret scan'],
  ['links', 'Link check (offline)'],
];

/** GitHub step outcome / job result → PROCEDURE.md status. */
function toCheck(name, outcome) {
  switch (outcome) {
    case 'success':
      return { name, status: 'pass', details: '' };
    case 'failure':
      return { name, status: 'fail', details: 'see the workflow run log' };
    case 'cancelled':
      return { name, status: 'skip', details: 'cancelled' };
    case 'skipped':
      return { name, status: 'skip', details: 'did not run (an earlier step failed)' };
    default:
      return { name, status: 'skip', details: 'did not run' };
  }
}

/**
 * @param {Record<string, {result?: string, outputs?: Record<string, string>}>} needs
 *   `toJSON(needs)` from the workflow.
 * @param {number} pr
 */
export function buildReport(needs, pr) {
  const checksJob = needs.checks ?? {};
  const outputs = checksJob.outputs ?? {};
  const checks = CHECK_STEPS.map(([id, name]) => toCheck(name, outputs[id]));
  if (checksJob.result === 'failure' && !checks.some((c) => c.status === 'fail')) {
    checks.push({
      name: 'CI checks job',
      status: 'fail',
      details: 'the job failed before its checks could report — open the run log',
    });
  }
  for (const [id, name] of JOBS) checks.push(toCheck(name, needs[id]?.result));
  return { pr, checks, overall: checks.some((c) => c.status === 'fail') ? 'fail' : 'pass' };
}

/**
 * @param {ReturnType<typeof buildReport>} report
 * @param {{runUrl: string, sha: string}} run
 */
export function renderComment(report, run) {
  const failed = report.checks.filter((c) => c.status === 'fail').length;
  const title =
    failed === 0
      ? 'QA summary: all checks passed'
      : `QA summary: ${failed} check${failed === 1 ? '' : 's'} failed`;
  const rows = report.checks.map((c) => `| ${c.name} | ${c.status.toUpperCase()} | ${c.details} |`);
  return [
    MARKER,
    `### ${title}`,
    '',
    '| Check | Result | Details |',
    '| --- | --- | --- |',
    ...rows,
    '',
    `Commit \`${run.sha.slice(0, 7)}\` · [workflow run](${run.runUrl}) · this comment is updated on every push.`,
    '',
    '<details><summary>Machine-readable result (agents/qa/PROCEDURE.md output schema)</summary>',
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```',
    '',
    '</details>',
    '',
  ].join('\n');
}

/**
 * Creates the QA comment, or updates the existing one (found by MARKER, bot-authored only).
 * @param {any} github Octokit from actions/github-script.
 * @param {{owner: string, repo: string, issue_number: number}} target
 * @param {string} body
 * @returns {Promise<'created' | 'updated'>}
 */
export async function upsertComment(github, target, body) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...target,
    per_page: 100,
  });
  const mine = comments.find((c) => c.user?.type === 'Bot' && c.body?.includes(MARKER));
  if (mine) {
    await github.rest.issues.updateComment({
      owner: target.owner,
      repo: target.repo,
      comment_id: mine.id,
      body,
    });
    return 'updated';
  }
  await github.rest.issues.createComment({ ...target, body });
  return 'created';
}
