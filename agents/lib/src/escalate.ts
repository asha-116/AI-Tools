// Open a `needs-owner` Issue: context, options, recommendation. One open Issue per key.

import type { EscalationRequest } from './errors.js';
import type { GitHubClient, WriteResult } from './github.js';
import { redact } from './redact.js';

export function escalationKey(req: EscalationRequest): string {
  const raw = req.key ?? req.title;
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'escalation'
  );
}

export function escalationMarker(agent: string, req: EscalationRequest): string {
  return `<!-- escalation:${agent}:${escalationKey(req)} -->`;
}

const clean = (s: string): string => redact(s).text;

/** The Issue body. All free text is redacted: Issues are as public as git. */
export function escalationBody(agent: string, req: EscalationRequest, runUrl?: string): string {
  return [
    `**Agent:** \`${agent}\`${runUrl ? ` · [run](${runUrl})` : ''}`,
    '',
    '## Context',
    '',
    clean(req.context),
    '',
    '## Options',
    '',
    ...req.options.map((o, i) => `${i + 1}. ${clean(o)}`),
    '',
    '## Recommendation',
    '',
    clean(req.recommendation),
    '',
    '---',
    '_Opened by an agent. The owner decides: reply here, or add `approved-by-owner` where an',
    'approval is needed, then close this Issue._',
    '',
    escalationMarker(agent, req),
  ].join('\n');
}

/**
 * Open a `needs-owner` Issue, or — if an open one with the same key exists — refresh this
 * agent's single comment on it instead of opening a duplicate.
 */
export async function escalate(
  gh: GitHubClient,
  agent: string,
  req: EscalationRequest,
  options: { runUrl?: string; now?: Date } = {},
): Promise<WriteResult & { deduped: boolean }> {
  const marker = escalationMarker(agent, req);
  let open: Awaited<ReturnType<GitHubClient['listIssues']>>;
  try {
    open = await gh.listIssues({ state: 'open', labels: ['needs-owner'], limit: 300 });
  } catch (err) {
    // In a dry run nothing is written anyway, so a failed read (no token, rate limit) must not
    // crash the run: treat it as "no existing Issue". Live runs still fail loudly, because
    // opening a duplicate Issue for the owner is worse than stopping.
    if (!gh.dryRun) throw err;
    open = [];
  }
  const existing = open.find((i) => i.body.includes(marker));
  if (existing) {
    const when = (options.now ?? new Date()).toISOString();
    const r = await gh.upsertComment(
      existing.number,
      `Still blocked as of ${when}${options.runUrl ? ` ([run](${options.runUrl}))` : ''}.`,
    );
    return {
      dryRun: r.dryRun,
      number: existing.number,
      html_url: existing.html_url,
      deduped: true,
    };
  }
  const r = await gh.createIssue({
    title: clean(req.title).slice(0, 120),
    body: escalationBody(agent, req, options.runUrl),
    labels: ['needs-owner', `agent:${agent}`],
  });
  return { ...r, deduped: false };
}
