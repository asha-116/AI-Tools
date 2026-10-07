// PROCEDURE step 6: the daily report (company/reports/daily/<YYYY-MM-DD>.md). Pure function.

import { redact, type IssueSummary, type WriteResult } from '../../lib/src/index.js';
import type { Aged, StaleData, WaitingPull, WorkflowRun } from './state.js';
import type { Task } from './tasks.js';

export type LlmStatus =
  | { status: 'used'; family: string; candidates: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

export interface ReportInput {
  date: string;
  yesterday: string;
  dryRun: boolean;
  /** null = could not be read (see `notes`). */
  merged: IssueSummary[] | null;
  created: { task: Task; result: WriteResult }[];
  dropped: { title: string; duplicateOf: string }[];
  stale: Aged<IssueSummary>[] | null;
  ownerIssues: IssueSummary[] | null;
  waitingPulls: WaitingPull[] | null;
  failing: WorkflowRun[] | null;
  staleData: StaleData[];
  unreadableData: string[];
  llm: LlmStatus;
  tokens: { run: number; perRun: number; daily: number; usedBeforeRun: number };
  tokenUsage: { agent: string; tokens: number }[];
  usageReport: string | null;
  /** Read failures and other caveats, one line each. */
  notes: string[];
}

/** Free text from GitHub is redacted and made table/markdown safe. */
export function clean(s: string): string {
  return redact(s)
    .text.replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, '/')
    .trim();
}

const UNAVAILABLE = '- _Unavailable this run (see Notes)._';

function list<T>(items: T[] | null, empty: string, line: (t: T) => string): string[] {
  if (items === null) return [UNAVAILABLE];
  return items.length ? items.map(line) : [`- ${empty}`];
}

const ref = (n: number, url: string) => (url.startsWith('http') ? `[#${n}](${url})` : `#${n}`);
const fmt = (n: number) => n.toLocaleString('en-US');

export function renderReport(r: ReportInput): string {
  const llmLine =
    r.llm.status === 'used'
      ? `LLM step ran (model family \`${r.llm.family}\`, ${r.llm.candidates} candidate(s) drafted).`
      : r.llm.status === 'skipped'
        ? `LLM step **skipped**: ${r.llm.reason}. Only state-derived tasks were considered.`
        : `LLM step **failed**: ${r.llm.reason}. Only state-derived tasks were considered.`;

  const blockers: string[] = [];
  for (const w of r.failing ?? []) {
    blockers.push(`- Failing workflow **${clean(w.name)}** — [last run](${w.html_url})`);
  }
  for (const d of r.staleData) {
    blockers.push(
      `- \`${d.path}\` last verified ${clean(d.last_verified)}` +
        (d.days === null ? ' (unreadable date)' : ` (${d.days} days ago, limit 180)`),
    );
  }
  for (const p of r.unreadableData) blockers.push(`- \`${p}\` is not valid JSON`);
  if (r.llm.status !== 'used') blockers.push(`- ${llmLine}`);

  const lines = [
    `# Daily report — ${r.date}`,
    '',
    `_Orchestrator${r.dryRun ? ' · **dry run** (nothing was written to GitHub)' : ''}. ` +
      'Repository metadata only — no customer data._',
    '',
    `## Merged yesterday (${r.yesterday})`,
    '',
    ...list(r.merged, 'Nothing merged.', (p) => `- ${ref(p.number, p.html_url)} ${clean(p.title)}`),
    '',
    '## New Issues',
    '',
    ...(r.created.length
      ? r.created.map(
          ({ task, result }) =>
            `- ${result.dryRun ? '(dry run)' : ref(result.number, result.html_url)} ` +
            `${clean(task.title)} — \`${task.labels.join('`, `')}\``,
        )
      : ['- None.']),
    ...(r.dropped.length
      ? [
          '',
          'Dropped as duplicates:',
          ...r.dropped.map((d) => `- ${clean(d.title)} ≈ ${clean(d.duplicateOf)}`),
        ]
      : []),
    '',
    '## Blockers',
    '',
    ...(blockers.length ? blockers : ['- None.']),
    '',
    '## Owner queue',
    '',
    '**Issues labelled `needs-owner`:**',
    '',
    ...list(r.ownerIssues, 'None.', (i) => `- ${ref(i.number, i.html_url)} ${clean(i.title)}`),
    '',
    '**PRs waiting on the owner** (`needs-owner`, or no review for more than 2 days):',
    '',
    ...list(
      r.waitingPulls,
      'None.',
      (p) =>
        `- ${ref(p.number, p.html_url)} ${clean(p.title)} — ` +
        `${p.reason === 'needs-owner' ? '`needs-owner`' : 'no review'}, ${p.days} day(s)`,
    ),
    '',
    '**Stale Issues** (no activity for more than 7 days):',
    '',
    ...list(
      r.stale,
      'None.',
      (a) => `- ${ref(a.item.number, a.item.html_url)} ${clean(a.item.title)} — ${a.days} days`,
    ),
    '',
    '## Token / Actions usage',
    '',
    `- This run: ${fmt(r.tokens.run)} tokens (per-run limit ${fmt(r.tokens.perRun)}; ` +
      `daily limit ${fmt(r.tokens.daily)}, ${fmt(r.tokens.usedBeforeRun)} used earlier today).`,
    ...(r.tokenUsage.length
      ? r.tokenUsage.map((u) => `- \`${u.agent}\` on ${r.yesterday}: ${fmt(u.tokens)} tokens`)
      : [`- No local agent logs for ${r.yesterday} (run logs are kept as workflow artifacts).`]),
    `- Actions minutes and Cloudflare usage: ${
      r.usageReport ? `see \`${r.usageReport}\`` : 'see the monthly Usage report workflow'
    } (≥ 70% opens a \`needs-owner\` Issue).`,
    ...(r.llm.status === 'used' ? [`- ${llmLine}`] : []),
    ...(r.notes.length ? ['', '## Notes', '', ...r.notes.map((n) => `- ${clean(n)}`)] : []),
    '',
  ];
  return lines.join('\n');
}
