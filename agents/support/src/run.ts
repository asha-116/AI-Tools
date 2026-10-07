// Support agent: fetch → redact → classify → KB template → refunds/bugs to humans → reply → log.
// Raw message text and the redaction map live in memory only. Logs, Issues and LLM prompts get
// redacted text or no text at all (AGENTS.md rule 2).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  redact,
  runAgent,
  type AgentContext,
  type RedactionMap,
  type RunOptions,
} from '../../lib/src/index.js';
import type { Handled } from '../schema.js';
import {
  classify,
  detectLanguage,
  detectProduct,
  detectRefundReason,
  isLegalThreat,
  MIN_CONFIDENCE,
  stripLinks,
  type ClassifyResult,
} from './classify.js';
import { inboxFromSetting, messageRef, type Inbox, type Message } from './inbox.js';
import {
  loadKnowledgeBase,
  pickTemplate,
  renderReply,
  type KnowledgeBase,
  type Language,
  type Template,
} from './kb.js';
import {
  evaluateRefund,
  maskPaymentId,
  parseThreshold,
  POLICY_PATH,
  type OrderLookup,
} from './refund.js';

export const AGENT = 'support';
/** PROCEDURE.md "Token budget per run". */
export const BUDGET = { perRun: 10_000, daily: 60_000 };
/** Messages handled per run; the rest wait for the next run (bounded tokens and minutes). */
export const MAX_MESSAGES_PER_RUN = 10;

export interface SupportDeps {
  inbox: Inbox;
  orders?: OrderLookup;
  maxMessages?: number;
}

export interface SupportSummary {
  fetched: number;
  handled: number;
  duplicates: number;
  deferred: number;
  replied: number;
  escalated: number;
  bugs: number;
  classifier: { llm: number; keywords: number };
}

interface RunState {
  llmAvailable: boolean;
  kb: KnowledgeBase;
  threshold: number;
  heldTemplates: Set<string>;
  orders?: OrderLookup;
}

/** Display name from a From header (`Asha Example <a@example.com>` → `Asha Example`). */
export function senderName(from: string): string | undefined {
  const m = /^\s*"?([^"<]*?)"?\s*</.exec(from);
  const name = m?.[1]?.trim();
  return name && !name.includes('@') ? name : undefined;
}

/** Redact subject + body (links removed first). The map stays in memory. */
export function redactMessage(msg: Message): { text: string; map: RedactionMap } {
  const name = senderName(msg.from);
  const names = name ? [name] : [];
  // classify() re-checks with containsPii() before any LLM call.
  const r = redact(stripLinks(`${msg.subject}\n\n${msg.body}`), { names });
  return { text: r.text, map: r.map };
}

/** The placeholder of the first Razorpay payment ID in the message, if any. */
export function paymentPlaceholder(map: RedactionMap): string | undefined {
  return Object.keys(map)
    .filter((k) => k.startsWith('[RAZORPAY_ID_') && (map[k] as string).startsWith('pay_'))
    .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]))[0];
}

function idLines(ref: string, msg: Message, language: Language): string[] {
  return [
    `- Message ref: \`${ref}\` (search the support inbox; the text is not copied here)`,
    `- Received: ${msg.receivedAt ? msg.receivedAt.toISOString() : 'unknown'}`,
    `- Language: ${language}`,
  ];
}

async function sendTemplate(
  ctx: AgentContext,
  deps: SupportDeps,
  state: RunState,
  msg: Message,
  template: Template,
  language: Language,
  values: Record<string, string | undefined>,
  map: RedactionMap,
): Promise<'replied' | 'would_reply' | 'held_unapproved_template'> {
  // Rendered (and restored) locally; the text is never logged.
  const text = renderReply(state.kb, template, language, values, map);
  if (ctx.dryRun) return 'would_reply';
  if (template.status !== 'approved') {
    state.heldTemplates.add(template.id);
    return 'held_unapproved_template';
  }
  await deps.inbox.sendReply(msg.id, text);
  return 'replied';
}

async function openBugIssue(
  ctx: AgentContext,
  ref: string,
  language: Language,
  product: string | undefined,
  cls: ClassifyResult,
): Promise<number> {
  const marker = `<!-- support-bug:${ref} -->`;
  const existing = (
    await ctx.github.listIssues({ state: 'all', labels: ['type:bug'], limit: 300 })
  ).find((i) => i.body.includes(marker));
  if (existing) return existing.number;
  const summary =
    cls.classifier === 'llm' && cls.summary
      ? redact(stripLinks(cls.summary)).text.slice(0, 300)
      : '(not available: keyword classification, no model summary)';
  const r = await ctx.github.createIssue({
    title: `Bug report from a buyer (${product ?? 'template not named'}) — ref ${ref}`,
    body: [
      'A buyer reported a problem with a template. The message stays in the support inbox and is',
      'not copied here (AGENTS.md rule 2).',
      '',
      `- Message ref: \`${ref}\``,
      `- Product: ${product ?? 'not named'}`,
      `- Language: ${language}`,
      `- Classifier: ${cls.classifier} (confidence ${cls.confidence.toFixed(2)})`,
      `- Summary (from redacted text): ${summary}`,
      '',
      'Next step: reproduce with the template in `products/`, fix in a PR. The buyer got the',
      '`bug-report-received` acknowledgement.',
      '',
      marker,
    ].join('\n'),
    labels: ['type:bug', `agent:${AGENT}`],
  });
  return r.number;
}

/** Handle one message end to end. Returns the log record (no text). */
export async function handleMessage(
  ctx: AgentContext,
  deps: SupportDeps,
  state: RunState,
  msg: Message,
): Promise<Handled> {
  const ref = messageRef(msg.id);
  const { text, map } = redactMessage(msg);
  const language = detectLanguage(text);
  const cls = await classify(ctx, text, state);
  const product = detectProduct(text);
  const payPh = paymentPlaceholder(map);
  const values = { payment_id: payPh };
  const base = {
    message_ref: ref,
    category: cls.category,
    language,
    classifier: cls.classifier,
    confidence: cls.confidence,
    refund: { eligible: null, amount_inr: null },
  };
  const escalated: Handled = {
    ...base,
    kb_article: null,
    template: null,
    action: 'escalate',
    outcome: 'escalated',
  };

  if (isLegalThreat(text)) {
    await ctx.escalate({
      title: `Support: legal threat or chargeback — ref ${ref}`,
      context: [
        'A buyer message mentions a chargeback, legal action, police or fraud. The agent does',
        'not reply to these.',
        '',
        ...idLines(ref, msg, language),
      ].join('\n'),
      options: ['Reply by hand.', 'Ask a lawyer before replying.'],
      recommendation:
        'Read the message in the inbox and reply by hand; no automatic reply was sent.',
      key: `support-legal-${ref}`,
    });
    return escalated;
  }

  if (cls.category === 'other' || cls.confidence < MIN_CONFIDENCE) {
    await ctx.escalate({
      title: `Support: message needs a human reply — ref ${ref}`,
      context: [
        `The agent could not answer this from the knowledge base (category ${cls.category},`,
        `confidence ${cls.confidence.toFixed(2)}, classifier ${cls.classifier}).`,
        '',
        ...idLines(ref, msg, language),
      ].join('\n'),
      options: [
        'Reply by hand.',
        'If this question comes up again, add a template to company/knowledge-base/ in a PR.',
      ],
      recommendation: 'Reply by hand; propose a KB template if it repeats within a week.',
      key: `support-review-${ref}`,
    });
    return escalated;
  }

  const template = pickTemplate(state.kb, cls.category, product) as Template;

  if (cls.category === 'refund_request') {
    const reason = detectRefundReason(text);
    const paymentId = payPh ? (map[payPh] as string) : undefined;
    const facts = paymentId && state.orders ? await state.orders.find(paymentId) : null;
    const decision = evaluateRefund(reason, facts, state.threshold, ctx.now());
    await ctx.escalate({
      title: `Refund request ${paymentId ? maskPaymentId(paymentId) : '(no payment ID)'} — owner decision`,
      context: [
        `A buyer asked for a refund. The Support agent may approve refunds up to ₹${state.threshold}`,
        `(${POLICY_PATH}), so the owner decides. The buyer got the \`${template.id}\``,
        'acknowledgement ("we will get back within 2 working days").',
        '',
        ...idLines(ref, msg, language),
        `- Payment ID: ${paymentId ? maskPaymentId(paymentId) : 'not given (ask for it)'}`,
        `- Policy case (keywords): ${reason}`,
        `- Eligible by policy: ${decision.eligible === null ? 'unknown' : decision.eligible ? 'yes' : 'no'}`,
        ...decision.notes.map((n) => `  - ${n}`),
      ].join('\n'),
      options: [
        'Eligible: refund in the Razorpay dashboard (original payment method), then reply to the buyer.',
        'Not eligible: reply to the buyer with the reason from the refund policy.',
        'Missing facts: ask the buyer for the payment ID only (never card or bank details).',
      ],
      recommendation:
        decision.eligible === false
          ? 'Not eligible by the policy facts known: reply politely with the policy reason.'
          : 'Check the order in D1 / Razorpay; refund within 2 working days if the policy allows it.',
      key: `support-refund-${ref}`,
    });
    const sent = await sendTemplate(ctx, deps, state, msg, template, language, values, map);
    return {
      ...base,
      refund: { eligible: decision.eligible, amount_inr: decision.amountInr },
      kb_article: template.id,
      template: template.id,
      action: 'escalate',
      outcome:
        sent === 'replied'
          ? 'escalated_and_replied'
          : sent === 'would_reply'
            ? 'escalated_would_reply'
            : 'held_unapproved_template',
    };
  }

  if (cls.category === 'bug') {
    const issue = await openBugIssue(ctx, ref, language, product, cls);
    ctx.log.info('bug.issue', { message_ref: ref, issue });
  }

  const sent = await sendTemplate(ctx, deps, state, msg, template, language, values, map);
  return {
    ...base,
    kb_article: template.id,
    template: template.id,
    action: 'reply',
    outcome: sent,
  };
}

/** The agent's logic over an injected inbox (tests pass a fileInbox over fixtures). */
export async function support(ctx: AgentContext, deps: SupportDeps): Promise<SupportSummary> {
  const root = ctx.config.repoRoot;
  const policyPath = join(root, POLICY_PATH);
  const state: RunState = {
    llmAvailable: true,
    kb: loadKnowledgeBase(root),
    threshold: parseThreshold(existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : null),
    heldTemplates: new Set(),
    ...(deps.orders ? { orders: deps.orders } : {}),
  };
  const summary: SupportSummary = {
    fetched: 0,
    handled: 0,
    duplicates: 0,
    deferred: 0,
    replied: 0,
    escalated: 0,
    bugs: 0,
    classifier: { llm: 0, keywords: 0 },
  };
  const messages = await deps.inbox.fetchNew();
  summary.fetched = messages.length;
  const seen = new Set<string>();
  const max = deps.maxMessages ?? MAX_MESSAGES_PER_RUN;

  for (const msg of messages) {
    const ref = messageRef(msg.id);
    if (seen.has(ref)) {
      summary.duplicates++;
      ctx.log.info('message.duplicate', { message_ref: ref });
      continue;
    }
    if (summary.handled >= max) {
      summary.deferred++;
      continue;
    }
    seen.add(ref);
    const record = await handleMessage(ctx, deps, state, msg);
    ctx.log.info('message.handled', { ...record });
    summary.handled++;
    summary.classifier[record.classifier]++;
    if (record.action === 'escalate') summary.escalated++;
    if (record.outcome === 'replied' || record.outcome === 'escalated_and_replied')
      summary.replied++;
    if (record.category === 'bug') summary.bugs++;
    if (!ctx.dryRun) await deps.inbox.markHandled(msg.id);
  }

  if (state.heldTemplates.size > 0) {
    const ids = [...state.heldTemplates].sort();
    await ctx.escalate({
      title: 'Support replies held: KB templates not approved',
      context: [
        'In a live run the agent only sends templates with `status: approved`. These are still',
        '`draft`, so the buyers got no automatic reply (their messages are marked handled):',
        '',
        ...ids.map((id) => `- company/knowledge-base/${id}.md`),
      ].join('\n'),
      options: [
        'Review the EN text and have a human review the Hindi, then set `status: approved` in a PR.',
        'Keep them as drafts and answer support mail by hand.',
      ],
      recommendation: 'Review and approve the templates; until then reply by hand.',
      key: 'support-templates-not-approved',
    });
  }
  if (summary.deferred > 0) ctx.log.info('inbox.deferred', { count: summary.deferred });
  ctx.log.info('support.done', { ...summary });
  return summary;
}

/** `--inbox=<value>` from argv, else SUPPORT_INBOX. */
export function inboxSetting(env: RunOptions['env'], argv: readonly string[]): string | undefined {
  const arg = argv.find((a) => a.startsWith('--inbox='));
  return arg ? arg.slice('--inbox='.length) : env?.SUPPORT_INBOX;
}

/** Entry point for `npm run agent -- support [--inbox=file:/path]`. */
export function main(
  options: RunOptions = {},
  deps: Partial<SupportDeps> & { argv?: readonly string[] } = {},
) {
  const env = options.env ?? process.env;
  return runAgent(
    AGENT,
    BUDGET,
    async (ctx) => {
      const inbox = deps.inbox ?? inboxFromSetting(inboxSetting(env, deps.argv ?? process.argv));
      if (!inbox) {
        ctx.log.info('inbox.none', { hint: 'set SUPPORT_INBOX (or --inbox=file:<dir>)' });
        return undefined;
      }
      return support(ctx, { ...deps, inbox });
    },
    options,
  );
}
