// Turns a VerifierReport into the `verifier` commit status and the single PR comment.

import type { CommitStatus } from '../../lib/src/index.js';
import type { VerifierReport } from '../schema.js';

export const STATUS_CONTEXT = 'verifier';

/** GitHub caps status descriptions at 140 characters. */
export function clip(text: string, max = 140): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Markdown table cell: one line, no pipes, bounded. */
export function cell(value: unknown, max = 160): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return clip((s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|'), max);
}

const num = (n: number | null): string =>
  n === null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(2);

export function statusFor(
  report: VerifierReport,
  headline: string,
  state?: CommitStatus['state'],
): Omit<CommitStatus, 'context'> & { context: typeof STATUS_CONTEXT } {
  const s: CommitStatus['state'] =
    state ??
    (report.verdict === 'pass' ? 'success' : report.verdict === 'fail' ? 'failure' : 'pending');
  return { context: STATUS_CONTEXT, state: s, description: clip(headline) };
}

export function renderComment(
  report: VerifierReport,
  headline: string,
  notes: string[] = [],
): string {
  const icon = report.verdict === 'pass' ? 'PASS' : report.verdict === 'fail' ? 'FAIL' : 'PENDING';
  const lines = [
    `## Verifier — ${icon}`,
    '',
    headline,
    '',
    `- Producer model family: \`${report.producer_model_family}\``,
    `- Verifier model family: \`${report.verifier_model_family}\``,
  ];
  if (report.reasons.length) {
    lines.push('', '### Reasons', '', ...report.reasons.map((r) => `- ${r}`));
  }
  if (notes.length) lines.push('', '### Notes', '', ...notes.map((n) => `- ${n}`));
  if (report.cases.length) {
    lines.push(
      '',
      '### Formula cases (verifier computed from the cited formula description, not our code)',
      '',
      '| Formula | Input | Field | Verifier | Ours | Match | Note |',
      '| --- | --- | --- | ---: | ---: | :---: | --- |',
      ...report.cases.map(
        (c) =>
          `| ${c.formula} | ${cell(c.input)} | ${c.field} | ${num(c.expected_by_verifier)} | ${num(c.actual)} | ${c.match ? 'yes' : '**no**'} | ${cell(c.note)} |`,
      ),
    );
  }
  if (report.claims.length) {
    lines.push(
      '',
      '### Claims',
      '',
      '| File | Claim | Source | Status | Note |',
      '| --- | --- | --- | --- | --- |',
      ...report.claims.map(
        (c) =>
          `| ${cell(c.file)} | ${cell(c.claim)} | ${cell(c.source || '—')} | ${c.supported ? 'supported' : `**${c.status}**`} | ${cell(c.note)} |`,
      ),
    );
  }
  lines.push(
    '',
    'Tolerance: ₹1 or 0.01%, whichever is larger. The Verifier never fixes code; a human decides.',
    '',
    '<details><summary>Report JSON</summary>',
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```',
    '',
    '</details>',
  );
  const body = lines.join('\n');
  // GitHub comments are capped at 65,536 characters.
  return body.length > 60_000 ? `${body.slice(0, 60_000)}\n\n… (truncated)` : body;
}
