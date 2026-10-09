// PROCEDURE steps 2 and 4: candidate tasks from the deterministic state, labels, ranking and
// the Issue body. Pure functions.

import { MAX_ISSUES, type Candidate, type TaskIssue } from '../schema.js';
import type { StaleData, WorkflowRun } from './state.js';

export type TaskSource = 'state' | 'llm';

/** A candidate ready for de-duplication and ranking. */
export interface Task extends Candidate {
  source: TaskSource;
  labels: string[];
}

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;

/** One `agent:*`, one `type:*`, `priority:*` unless normal, `needs-owner` when flagged. */
export function taskLabels(c: Candidate): string[] {
  const labels = [`agent:${c.agent}`, `type:${c.type}`];
  if (c.priority !== 'normal') labels.push(`priority:${c.priority}`);
  if (c.needs_owner) labels.push('needs-owner');
  return labels;
}

export function toTask(c: Candidate, source: TaskSource): Task {
  return { ...c, source, labels: taskLabels(c) };
}

/** Goal impact ÷ effort. */
export function score(c: Pick<Candidate, 'impact' | 'effort'>): number {
  return c.impact / c.effort;
}

/**
 * Highest impact ÷ effort first; ties: priority, then state-derived tasks (facts beat ideas),
 * then title. Keeps at most `cap`.
 */
export function rankTasks<T extends Task>(tasks: readonly T[], cap = MAX_ISSUES): T[] {
  return [...tasks]
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        (a.source === b.source ? 0 : a.source === 'state' ? -1 : 1) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, Math.max(0, cap));
}

function shortTitle(s: string): string {
  return s.length <= 80 ? s : `${s.slice(0, 79)}…`;
}

/** Tasks that follow directly from the state: failing workflows and stale rate files. */
export function stateTasks(state: { failing: WorkflowRun[]; staleData: StaleData[] }): Task[] {
  const out: Task[] = [];
  for (const w of state.failing) {
    out.push(
      toTask(
        {
          title: shortTitle(`Fix failing workflow: ${w.name}`),
          agent: 'engineer',
          type: 'infra',
          goal: 'Keep CI and scheduled jobs green so agents and deploys keep working.',
          acceptance: [
            `The cause of the failure in ${w.path || w.name} is identified in the PR description`,
            'The next run of the workflow succeeds',
            'No secret or permission is widened without an owner-approved Issue',
          ],
          inputs: [w.html_url, w.path || w.name],
          token_budget: 15_000,
          priority: 'high',
          impact: 4,
          effort: 2,
          needs_owner: false,
        },
        'state',
      ),
    );
  }
  for (const d of state.staleData) {
    out.push(
      toTask(
        {
          title: shortTitle(`Re-verify ${d.path} (last verified ${d.last_verified})`),
          agent: 'engineer',
          type: 'data',
          goal: 'Rates are data with a source and a fresh last_verified date (AGENTS.md rule 6).',
          acceptance: [
            'Every source URL in the file is re-checked against the official page',
            'Changed values cite the notification; last_verified is updated',
            'Verifier check passes on the PR',
          ],
          inputs: [d.path],
          token_budget: 10_000,
          priority: 'normal',
          impact: 3,
          effort: 2,
          needs_owner: false,
        },
        'state',
      ),
    );
  }
  return out;
}

/** The PROCEDURE output shape of a task (drops ranking-only fields). */
export function toIssue(t: Task): TaskIssue {
  return {
    title: t.title,
    agent: t.agent,
    type: t.type,
    goal: t.goal,
    acceptance: t.acceptance,
    inputs: t.inputs,
    token_budget: t.token_budget,
    priority: t.priority,
  };
}

export const TASK_MARKER = '<!-- orchestrator:task -->';

/** Issue body: goal, checkable acceptance criteria, inputs, budget, provenance. */
export function issueBody(t: Task, meta: { date: string; runUrl?: string }): string {
  return [
    TASK_MARKER,
    `**Goal:** ${t.goal}`,
    '',
    '## Acceptance criteria',
    ...t.acceptance.map((a) => `- [ ] ${a}`),
    '',
    '## Inputs / sources',
    ...(t.inputs.length ? t.inputs.map((i) => `- ${i}`) : ['- (none)']),
    '',
    `**Token budget:** ${t.token_budget.toLocaleString('en-US')} · **Priority:** ${t.priority} · ` +
      `**Impact/effort:** ${t.impact}/${t.effort}`,
    ...(t.needs_owner
      ? ['', '> Needs owner approval before any agent acts (money, legal, pricing or claims).']
      : []),
    '',
    `_Opened by the Orchestrator on ${meta.date}` +
      `${meta.runUrl ? ` ([run](${meta.runUrl}))` : ''} from ` +
      `${t.source === 'state' ? 'repository state' : 'company/goals.md'}._`,
  ].join('\n');
}
