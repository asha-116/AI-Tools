// The Orchestrator (agents/orchestrator/PROCEDURE.md steps 1–6): plans the day as ≤ 5 Issues and
// writes the daily report as a PR on agent/orchestrator/<date>. Dry-run by default.
//
// Without an LLM provider key the run still produces the state-derived part (failing workflows,
// stale rate files, owner queue) and logs `llm.skipped`.

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  availableProviders,
  BudgetExceeded,
  chatJson,
  DEFAULT_REPOSITORY,
  Escalation,
  LlmUnavailable,
  loadProviders,
  promptSections,
  redact,
  renderTemplate,
  runAgent,
  type AgentContext,
  type EscalationRequest,
  type IssueSummary,
  type RunOptions,
  type WriteResult,
} from '../../lib/src/index.js';
import {
  DraftSchema,
  OutputSchema,
  TASK_AGENTS,
  TASK_TYPES,
  type Candidate,
  type OrchestratorOutput,
} from '../schema.js';
import { listWorkflowRuns } from './actions.js';
import { dedupe } from './dedupe.js';
import {
  clip,
  latestUsageReport,
  readDataFiles,
  readLatestMemory,
  readRecentReports,
  readTokenUsage,
} from './inputs.js';
import { renderReport, type LlmStatus } from './report.js';
import {
  addDays,
  failingWorkflows,
  goalsAreEmpty,
  istDate,
  ownerIssues,
  prsWaitingOnOwner,
  staleDataFiles,
  staleIssues,
  type WorkflowRun,
} from './state.js';
import { issueBody, rankTasks, stateTasks, toIssue, toTask, type Task } from './tasks.js';

/** PROCEDURE.md "Token budget per run". */
export const BUDGET = { perRun: 20_000, daily: 30_000 } as const;
export const GOALS_PATH = 'company/goals.md';

export interface OrchestrateOptions {
  /** Workflow runs created on/after `since`; default: GitHub Actions REST API. */
  listRuns?: (since: string) => Promise<WorkflowRun[]>;
  fetch?: typeof fetch;
}

export interface OrchestratorResult extends OrchestratorOutput {
  llm: LlmStatus;
  reportPath: string;
  created: WriteResult[];
  pr: WriteResult;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const safe = (s: string) => redact(s).text;

/** Run a read; on failure log it, add a note and return null (budget/escalation still stop). */
async function attempt<T>(
  ctx: AgentContext,
  what: string,
  notes: string[],
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BudgetExceeded) throw e;
    ctx.log.warn('read.failed', { what, error: e });
    notes.push(`Could not read ${what}: ${message(e)}`);
    return null;
  }
}

async function escalateSafely(ctx: AgentContext, req: EscalationRequest, notes: string[]) {
  try {
    const r = await ctx.escalate(req);
    ctx.log.warn('escalated', { key: req.key, issue: r.number, deduped: r.deduped });
  } catch (e) {
    ctx.log.error('escalation.failed', { key: req.key, error: e });
    notes.push(`Could not open the needs-owner Issue "${req.title}": ${message(e)}`);
  }
}

function readRepoFile(root: string, path: string): string | null {
  const full = join(root, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

export interface DraftInput {
  date: string;
  goals: string;
  state: string;
  openIssues: readonly IssueSummary[];
  reports: { date: string; text: string }[];
  memory: string;
}

/** The user-prompt slot values. Every free-text value is redacted. */
export function promptVars(d: DraftInput): Record<string, string> {
  const issues = d.openIssues
    .slice(0, 60)
    .map((i) => `- #${i.number} ${i.title.replace(/\s+/g, ' ')} — ${i.labels.join(', ') || '—'}`);
  return {
    date: d.date,
    goals: safe(clip(d.goals.trim(), 4000)),
    state: safe(d.state),
    open_issues: safe(issues.join('\n') || '(none)'),
    reports: safe(
      d.reports.map((r) => `#### ${r.date}\n${r.text.trim()}`).join('\n\n') || '(none yet)',
    ),
    memory: safe(d.memory || '(none yet)'),
  };
}

/** PROCEDURE step 2: LLM-drafted candidates, schema-validated (retry once, then Escalation). */
export async function draftTasks(
  ctx: AgentContext,
  input: DraftInput,
): Promise<{ candidates: Candidate[]; family: string }> {
  const p = promptSections(ctx.readFile('prompt.md'));
  const system = renderTemplate(p['system'] ?? '', {
    agents: TASK_AGENTS.join(', '),
    types: TASK_TYPES.join(', '),
  });
  const user = renderTemplate(p['user'] ?? '', promptVars(input));
  const { data, response } = await chatJson(
    ctx.llm,
    {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      maxTokens: 3000,
    },
    DraftSchema,
    'orchestrator plan',
    { log: ctx.log },
  );
  return { candidates: data.candidates, family: response.family };
}

/** Short plain-text summary of the computed state for the prompt. */
export function stateSummary(s: {
  merged: IssueSummary[] | null;
  staleCount: number | null;
  ownerCount: number | null;
  waitingCount: number | null;
  failing: WorkflowRun[] | null;
  staleData: string[];
}): string {
  const n = (v: number | null) => (v === null ? 'unknown' : String(v));
  return [
    `- Merged yesterday: ${s.merged === null ? 'unknown' : s.merged.map((m) => m.title).join('; ') || 'none'}`,
    `- Stale Issues (> 7 days idle): ${n(s.staleCount)}`,
    `- Owner queue: ${n(s.ownerCount)} needs-owner Issue(s), ${n(s.waitingCount)} PR(s) waiting`,
    `- Failing workflows: ${s.failing === null ? 'unknown' : s.failing.map((f) => f.name).join(', ') || 'none'} (already planned separately)`,
    `- Rate files past 180 days: ${s.staleData.join(', ') || 'none'} (already planned separately)`,
  ].join('\n');
}

export async function orchestrate(
  ctx: AgentContext,
  opts: OrchestrateOptions = {},
): Promise<OrchestratorResult> {
  const now = ctx.now();
  const date = istDate(now);
  const yesterday = addDays(date, -1);
  const root = ctx.config.repoRoot;
  const usedBeforeRun = ctx.budget.usedBeforeRun;
  const notes: string[] = [];
  const listRuns =
    opts.listRuns ??
    ((since: string) =>
      listWorkflowRuns(
        {
          repository: ctx.config.env['GITHUB_REPOSITORY'] || DEFAULT_REPOSITORY,
          token: ctx.config.githubToken,
          ...(opts.fetch ? { fetch: opts.fetch } : {}),
        },
        since,
      ));

  // 1. Inputs and state.
  const goals = readRepoFile(root, GOALS_PATH) ?? '';
  const openIssues = await attempt(ctx, 'open Issues', notes, () =>
    ctx.github.listIssues({ state: 'open', limit: 300 }),
  );
  const openPulls = await attempt(ctx, 'open PRs', notes, () =>
    ctx.github.listPulls({ state: 'open', limit: 100 }),
  );
  const unreviewed = await attempt(ctx, 'unreviewed PRs', notes, () =>
    ctx.github.searchIssues('is:pr is:open review:none', 100),
  );
  const merged = await attempt(ctx, 'merged PRs', notes, () =>
    ctx.github.searchIssues(`is:pr is:merged merged:${yesterday}`, 100),
  );
  const runs = await attempt(ctx, 'workflow runs', notes, () => listRuns(addDays(date, -7)));
  const data = readDataFiles(root);

  const stale = openIssues && staleIssues(openIssues, now);
  const owner = openIssues && ownerIssues(openIssues);
  const waiting = openPulls && unreviewed ? prsWaitingOnOwner(openPulls, unreviewed, now) : null;
  const failing = runs && failingWorkflows(runs);
  const staleData = staleDataFiles(data.files, now);
  ctx.log.info('state', {
    open_issues: openIssues?.length ?? null,
    stale_issues: stale?.length ?? null,
    owner_issues: owner?.length ?? null,
    waiting_prs: waiting?.length ?? null,
    failing_workflows: failing?.length ?? null,
    stale_data: staleData.length,
  });

  // 2. Candidates: state-derived, plus LLM-drafted from the goals.
  const candidates: Task[] = stateTasks({ failing: failing ?? [], staleData });
  let llm: LlmStatus;
  if (goalsAreEmpty(goals)) {
    llm = { status: 'skipped', reason: `${GOALS_PATH} has no goals (asked the owner)` };
    await escalateSafely(
      ctx,
      {
        title: 'Orchestrator: company/goals.md has no goals',
        context: `${GOALS_PATH} has no goal bullets, so the Orchestrator cannot plan work.`,
        options: ['Add ≤ 5 bullets for this week and this month.', 'Pause the agents.'],
        recommendation: 'Add this week’s goals; the next daily run will plan from them.',
        key: 'orchestrator-goals-empty',
      },
      notes,
    );
  } else if (openIssues === null) {
    const noProvider = availableProviders(loadProviders(), ctx.config.env).length === 0;
    llm = {
      status: 'skipped',
      reason:
        'open Issues could not be read (duplicates unknown)' +
        (noProvider ? '; also no LLM provider configured (no API key set)' : ''),
    };
  } else {
    try {
      const reports = readRecentReports(root, date);
      const memory = readLatestMemory(root);
      const draft = await draftTasks(ctx, {
        date,
        goals,
        state: stateSummary({
          merged,
          staleCount: stale?.length ?? null,
          ownerCount: owner?.length ?? null,
          waitingCount: waiting?.length ?? null,
          failing,
          staleData: staleData.map((d) => d.path),
        }),
        openIssues,
        reports,
        memory: memory ? `${memory.file}\n${memory.text}` : '',
      });
      candidates.push(...draft.candidates.map((c) => toTask(c, 'llm')));
      llm = { status: 'used', family: draft.family, candidates: draft.candidates.length };
    } catch (e) {
      if (e instanceof LlmUnavailable && e.attempts.length === 0) {
        llm = { status: 'skipped', reason: 'no LLM provider configured (no API key set)' };
      } else if (e instanceof LlmUnavailable) {
        llm = { status: 'failed', reason: message(e) };
      } else if (e instanceof Escalation) {
        llm = { status: 'failed', reason: 'invalid model output twice (asked the owner)' };
        await escalateSafely(ctx, e.request, notes);
      } else {
        throw e;
      }
    }
  }
  ctx.log.info(`llm.${llm.status}`, { ...llm });

  // 3–4. De-duplicate against open Issues, rank by impact ÷ effort, keep ≤ 5.
  // Without the open-Issue list duplicates cannot be ruled out, so nothing is opened.
  const { kept, dropped } = dedupe(candidates, openIssues ?? []);
  const chosen = openIssues === null ? [] : rankTasks(kept);
  if (openIssues === null && candidates.length) {
    notes.push(`${candidates.length} candidate task(s) not opened: open Issues unknown.`);
  }

  // 5. Create Issues (no-ops under DRY_RUN).
  const runUrl =
    ctx.config.env['GITHUB_SERVER_URL'] && ctx.config.env['GITHUB_RUN_ID']
      ? `${ctx.config.env['GITHUB_SERVER_URL']}/${ctx.config.env['GITHUB_REPOSITORY'] ?? DEFAULT_REPOSITORY}/actions/runs/${ctx.config.env['GITHUB_RUN_ID']}`
      : undefined;
  const created: { task: Task; result: WriteResult }[] = [];
  for (const task of chosen) {
    const result = await ctx.github.createIssue({
      title: task.title,
      body: issueBody(task, { date, ...(runUrl ? { runUrl } : {}) }),
      labels: task.labels,
    });
    created.push({ task, result });
  }
  ctx.log.info('issues', {
    candidates: candidates.length,
    duplicates: dropped.length,
    created: created.length,
    dry_run: ctx.dryRun,
  });

  // 6. Daily report → disk (and job summary), then a PR on agent/orchestrator/<date>.
  const report = renderReport({
    date,
    yesterday,
    dryRun: ctx.dryRun,
    merged,
    created,
    dropped: dropped.map((d) => ({
      title: d.candidate.title,
      duplicateOf:
        'number' in d.duplicateOf
          ? `#${String(d.duplicateOf.number)} ${d.duplicateOf.title}`
          : d.duplicateOf.title,
    })),
    stale,
    ownerIssues: owner,
    waitingPulls: waiting,
    failing,
    staleData,
    unreadableData: data.unreadable,
    llm,
    tokens: {
      run: ctx.budget.used,
      perRun: BUDGET.perRun,
      daily: BUDGET.daily,
      usedBeforeRun,
    },
    tokenUsage: readTokenUsage(root, yesterday),
    usageReport: latestUsageReport(root),
    notes,
  });
  const reportPath = `company/reports/daily/${date}.md`;
  const full = join(root, reportPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, report);
  const summary = ctx.config.env['GITHUB_STEP_SUMMARY'];
  if (summary) appendFileSync(summary, `${report}\n`);

  const pr = await ctx.github.openPullRequest({
    branch: `agent/orchestrator/${date}`,
    title: `docs: daily report ${date}`,
    body: [
      `Daily report for ${date} by the Orchestrator. Report only — no code changes.`,
      '',
      `- New Issues: ${created.length}${ctx.dryRun ? ' (dry run)' : ''}`,
      `- LLM step: ${llm.status}`,
    ].join('\n'),
    files: [{ path: reportPath, content: report }],
    labels: ['agent:orchestrator'],
  });
  ctx.log.info('report', { path: reportPath, pr: pr.number, dry_run: pr.dryRun });

  const output = OutputSchema.parse({
    date,
    issues: created.map((c) => toIssue(c.task)),
    report_markdown: report,
  });
  return { ...output, llm, reportPath, created: created.map((c) => c.result), pr };
}

/** Entry point for `npm run agent -- orchestrator`. */
export function main(options?: RunOptions) {
  return runAgent(
    'orchestrator',
    BUDGET,
    (ctx) => orchestrate(ctx, options?.fetch ? { fetch: options.fetch } : {}),
    options,
  );
}
