import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LlmUnavailable } from '../../lib/src/index.js';
import {
  fakeLlm,
  MemoryGitHub,
  memoryLogger,
  testContext,
  testRunOptions,
  type FakeReply,
} from '../../lib/src/testing.js';
import { fileInbox, messageRef, type Inbox, type Message } from '../src/inbox.js';
import {
  inboxSetting,
  main,
  paymentPlaceholder,
  redactMessage,
  senderName,
  support,
} from '../src/run.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const FIXTURES = join(import.meta.dirname, 'fixtures', 'inbox');

// Everything personal in the fixtures (all fake). None of it may reach an LLM, a log or an Issue.
const PII = [
  /@example\.com/i,
  /9999999999/,
  /99999 99999/,
  /pay_TEST/,
  /Testy/,
  /Fakebuyer/,
  /Nakli/,
  /नकली/,
  /Fakey/,
  /Testperson/,
  /FAKE\.TOKEN/,
];
// Fragments of message text and reply text: never in logs or Issues.
const TEXT = [/says expired/, /पसंद नहीं/, /kaise use/, /get-download/, /Hello,/, /नमस्ते/];

function tempInbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'support-inbox-'));
  cpSync(FIXTURES, dir, { recursive: true });
  return dir;
}

/** A repo root copy whose KB templates are approved (for live-send tests). */
function approvedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'support-root-'));
  for (const d of ['company/knowledge-base', 'company/policies', 'agents/support']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  const kb = join(ROOT, 'company/knowledge-base');
  for (const f of readdirSync(kb)) {
    const text = readFileSync(join(kb, f), 'utf8').replace('status: draft', 'status: approved');
    writeFileSync(join(root, 'company/knowledge-base', f), text);
  }
  cpSync(join(ROOT, 'company/policies'), join(root, 'company/policies'), { recursive: true });
  cpSync(join(ROOT, 'agents/support/prompt.md'), join(root, 'agents/support/prompt.md'));
  return root;
}

const reply = (category: string, confidence = 0.95, summary = '') =>
  JSON.stringify({ category, confidence, summary });

// Fixture order after dedupe: download, refund (HI), how-to (Hinglish), bug, other, legal.
const LLM_REPLIES: FakeReply[] = [
  reply('download_issue'),
  reply('refund_request'),
  reply('how_to'),
  reply(
    'bug',
    0.9,
    'Pending column shows #REF! after adding a row; mail [EMAIL_1] pay_TESTX1234567',
  ),
  reply('other', 0.9),
  reply('refund_request'),
];

function handled(lines: Record<string, unknown>[]) {
  return lines.filter((l) => l.event === 'message.handled') as Record<string, unknown>[];
}

function assertClean(label: string, value: unknown, patterns: RegExp[]) {
  const s = JSON.stringify(value);
  for (const re of patterns) expect(s, `${label} must not match ${re}`).not.toMatch(re);
}

describe('support pipeline (dry-run, fake LLM)', () => {
  async function run(replies: FakeReply[] = LLM_REPLIES) {
    const github = new MemoryGitHub({ agent: 'support', dryRun: true });
    const llm = fakeLlm(replies);
    const logger = memoryLogger('support');
    const inbox = fileInbox(tempInbox());
    const ctx = testContext('support', { llm, github, logger });
    const summary = await support(ctx, { inbox });
    return { github, llm, logger, inbox, summary };
  }

  it('handles every message once (duplicate Message-ID skipped)', async () => {
    const { summary, logger } = await run();
    expect(summary).toMatchObject({ fetched: 7, handled: 6, duplicates: 1, deferred: 0 });
    expect(logger.lines.filter((l) => l.event === 'message.duplicate')).toHaveLength(1);
  });

  it('PII never reaches the LLM: no email, phone, name, payment id or link in any prompt', async () => {
    const { llm } = await run();
    expect(llm.requests).toHaveLength(6);
    for (const req of llm.requests) assertClean('prompt', req.messages, PII);
    const prompts = JSON.stringify(llm.requests);
    expect(prompts).toContain('[RAZORPAY_ID_1]');
    expect(prompts).toContain('[PHONE_1]');
    expect(prompts).toContain('[LINK]');
  });

  it('logs one record per message with ref, category, template, outcome — no text, no PII', async () => {
    const { logger } = await run();
    const recs = handled(logger.lines);
    expect(recs.map((r) => [r.category, r.language, r.template, r.outcome])).toEqual([
      ['download_issue', 'en', 'download-link-help', 'would_reply'],
      ['refund_request', 'hi', 'refund-request-received', 'escalated_would_reply'],
      ['how_to', 'hi', 'how-to-lead-tracker', 'would_reply'],
      ['bug', 'en', 'bug-report-received', 'would_reply'],
      ['other', 'en', null, 'escalated'],
      ['refund_request', 'en', null, 'escalated'],
    ]);
    expect(recs[0]?.message_ref).toBe(messageRef('<fake-0001@example.com>'));
    for (const r of recs) {
      expect(Object.keys(r).sort()).toEqual(
        [
          'action',
          'agent',
          'category',
          'classifier',
          'confidence',
          'kb_article',
          'language',
          'level',
          'message_ref',
          'outcome',
          'refund',
          'template',
          'event',
          'ts',
        ].sort(),
      );
    }
    assertClean('logs', logger.lines, [...PII, ...TEXT]);
  });

  it('refund always escalates at threshold ₹0 with a redacted, masked summary', async () => {
    const { github } = await run();
    const refund = github.issues.find((i) => i.title.startsWith('Refund request'));
    expect(refund?.title).toBe('Refund request pay_…0001 — owner decision');
    expect(refund?.labels).toEqual(['needs-owner', 'agent:support']);
    expect(refund?.body).toContain('up to ₹0');
    expect(refund?.body).toContain('Policy case (keywords): changed_mind');
    expect(refund?.body).toContain('Eligible by policy: unknown');
    expect(refund?.body).toContain(messageRef('<fake-0002@example.com>'));
    for (const i of github.issues) assertClean(`Issue ${i.title}`, i, [...PII, ...TEXT]);
  });

  it('bug → one redacted type:bug Issue', async () => {
    const { github } = await run();
    const bugs = github.issues.filter((i) => i.labels.includes('type:bug'));
    expect(bugs).toHaveLength(1);
    expect(bugs[0]?.title).toContain('commission-ledger');
    expect(bugs[0]?.labels).toEqual(['type:bug', 'agent:support']);
    expect(bugs[0]?.body).toContain('#REF!');
    expect(bugs[0]?.body).toContain('[RAZORPAY_ID_1]');
    assertClean('bug Issue', bugs[0], [...PII, ...TEXT]);
  });

  it('other / legal → needs-owner, no reply', async () => {
    const { github } = await run();
    const titles = github.issues.map((i) => i.title);
    expect(titles.some((t) => t.startsWith('Support: message needs a human reply'))).toBe(true);
    expect(titles.some((t) => t.startsWith('Support: legal threat or chargeback'))).toBe(true);
  });

  it('dry-run never sends or marks handled', async () => {
    const { inbox } = await run();
    expect(inbox.sent).toEqual([]);
    expect(await inbox.fetchNew()).toHaveLength(7);
  });

  it('low confidence → escalate, no template', async () => {
    const replies = [...LLM_REPLIES];
    replies[0] = reply('download_issue', 0.5);
    const { logger } = await run(replies);
    expect(handled(logger.lines)[0]).toMatchObject({ outcome: 'escalated', template: null });
  });

  it('works with no LLM provider (keyword fallback), same categories', async () => {
    const { logger, summary } = await run([new LlmUnavailable([])]);
    expect(summary.classifier).toEqual({ llm: 0, keywords: 6 });
    expect(handled(logger.lines).map((r) => r.category)).toEqual([
      'download_issue',
      'refund_request',
      'how_to',
      'bug',
      'other',
      'other', // the chargeback message: escalated as a legal threat whatever the category
    ]);
    const bug = handled(logger.lines)[3];
    expect(bug?.template).toBe('bug-report-received');
  });

  it('defers messages beyond the per-run cap', async () => {
    const inbox = fileInbox(tempInbox());
    const ctx = testContext('support', { llm: fakeLlm([new LlmUnavailable([])]) });
    const s = await support(ctx, { inbox, maxMessages: 2 });
    expect(s).toMatchObject({ handled: 2, deferred: 4, duplicates: 1 });
  });

  it('uses an order lookup for refund facts when one is given', async () => {
    const github = new MemoryGitHub({ agent: 'support', dryRun: true });
    const inbox = fileInbox(tempInbox());
    const ctx = testContext('support', {
      llm: fakeLlm([new LlmUnavailable([])]),
      github,
      now: () => new Date('2026-10-07T00:00:00Z'),
    });
    const seen: string[] = [];
    await support(ctx, {
      inbox,
      orders: {
        find: async (id) => {
          seen.push(id);
          return {
            purchasedAt: new Date('2026-10-05T00:00:00Z'),
            refundsForBuyer: 0,
            amountInr: 299,
          };
        },
      },
    });
    expect(seen).toEqual(['pay_TESTREFUND0001']);
    const refund = github.issues.find((i) => i.title.startsWith('Refund request'));
    expect(refund?.body).toContain('Eligible by policy: yes');
    expect(refund?.body).toContain('Above the threshold');
  });
});

describe('support pipeline (live mode)', () => {
  const live = { DRY_RUN: 'false' };

  it('sends approved templates (HI for Hindi), restores the payment id locally, marks handled', async () => {
    const dir = tempInbox();
    const inbox = fileInbox(dir);
    const github = new MemoryGitHub({ agent: 'support' });
    const logger = memoryLogger('support');
    const ctx = testContext('support', {
      llm: fakeLlm(LLM_REPLIES),
      github,
      logger,
      env: live,
      repoRoot: approvedRoot(),
    });
    const s = await support(ctx, { inbox });
    expect(s.replied).toBe(4);
    expect(inbox.sent.map((r) => r.id)).toEqual([
      '<fake-0001@example.com>',
      '<fake-0002@example.com>',
      '<fake-0003@example.com>',
      '<fake-0004@example.com>',
    ]);
    const [download, refund, howto] = inbox.sent.map((r) => r.text);
    expect(download).toContain('Payment ID: pay_TESTX7Q2ABCD');
    expect(download).toContain('72 hours');
    expect(refund).toContain('पेमेंट ID: pay_TESTREFUND0001');
    expect(refund).toContain('2 कामकाजी दिनों');
    expect(howto).toContain('लीड ट्रैकर');
    expect(howto).toContain('Razorpay रसीद पर लिखी पेमेंट ID जवाब में भेजें'); // no payment id in that message → HI default
    expect(handled(logger.lines).map((r) => r.outcome)).toEqual([
      'replied',
      'escalated_and_replied',
      'replied',
      'replied',
      'escalated',
      'escalated',
    ]);
    assertClean('logs', logger.lines, [...PII, ...TEXT]);

    // Idempotent: a second run (new process) sees nothing new.
    const again = fileInbox(dir);
    const s2 = await support(
      testContext('support', { llm: fakeLlm([]), github, env: live, repoRoot: approvedRoot() }),
      { inbox: again },
    );
    expect(s2).toMatchObject({ fetched: 0, handled: 0 });
    expect(again.sent).toEqual([]);
  });

  it('holds draft templates: no reply sent, one needs-owner Issue listing them', async () => {
    const inbox = fileInbox(tempInbox());
    const github = new MemoryGitHub({ agent: 'support' });
    const logger = memoryLogger('support');
    const ctx = testContext('support', { llm: fakeLlm(LLM_REPLIES), github, logger, env: live });
    const s = await support(ctx, { inbox });
    expect(inbox.sent).toEqual([]);
    expect(s.replied).toBe(0);
    expect(
      handled(logger.lines).filter((r) => r.outcome === 'held_unapproved_template'),
    ).toHaveLength(4);
    const held = github.issues.filter((i) => i.title.includes('templates not approved'));
    expect(held).toHaveLength(1);
    expect(held[0]?.body).toContain('company/knowledge-base/download-link-help.md');
  });

  it('a bug Issue is not opened twice for the same message', async () => {
    const github = new MemoryGitHub({ agent: 'support' });
    const msg: Message = {
      id: '<fake-bug@example.com>',
      from: 'x@example.com',
      subject: 'error',
      body: 'The ledger shows #VALUE!',
    };
    const inbox: Inbox = {
      fetchNew: async () => [msg],
      markHandled: async () => undefined,
      sendReply: async () => undefined,
    };
    for (let i = 0; i < 2; i++) {
      await support(
        testContext('support', { llm: fakeLlm([new LlmUnavailable([])]), github, env: live }),
        { inbox },
      );
    }
    expect(github.issues.filter((i) => i.labels.includes('type:bug'))).toHaveLength(1);
  });
});

describe('edge cases', () => {
  function memInbox(msgs: Message[]): Inbox {
    return {
      fetchNew: async () => msgs,
      markHandled: async () => undefined,
      sendReply: async () => undefined,
    };
  }

  it('refund without payment id or date; ineligible by lookup; bug without product; no policy file', async () => {
    const root = approvedRoot();
    rmSync(join(root, 'company/policies'), { recursive: true });
    const github = new MemoryGitHub({ agent: 'support', dryRun: true });
    const inbox = memInbox([
      { id: '<r1>', from: '', subject: 'refund', body: 'I want a refund, did not like it' },
      { id: '<r2>', from: '', subject: 'refund', body: 'refund please pay_TESTNOTOK0001' },
      { id: '<b1>', from: '', subject: 'bug', body: 'The sheet shows #VALUE!' },
    ]);
    await support(
      testContext('support', {
        llm: fakeLlm([new LlmUnavailable([])]),
        github,
        repoRoot: root,
      }),
      { inbox, orders: { find: async () => ({ refundsForBuyer: 1 }) } },
    );
    const [first, second, bug] = github.issues;
    expect(first?.title).toBe('Refund request (no payment ID) — owner decision');
    expect(first?.body).toContain('Received: unknown');
    expect(first?.body).toContain('not given (ask for it)');
    expect(first?.body).toContain('up to ₹0');
    expect(second?.body).toContain('Eligible by policy: no');
    expect(second?.body).toContain('Not eligible by the policy facts known');
    expect(bug?.title).toContain('template not named');
    expect(bug?.body).toContain('Product: not named');
  });
});

describe('helpers', () => {
  it('senderName', () => {
    expect(senderName('"Testy Fakebuyer" <t@example.com>')).toBe('Testy Fakebuyer');
    expect(senderName('Fakey Testperson <f@example.com>')).toBe('Fakey Testperson');
    expect(senderName('plain@example.com')).toBeUndefined();
    expect(senderName('<a@example.com>')).toBeUndefined();
    expect(senderName('a@example.com <a@example.com>')).toBeUndefined();
  });

  it('redactMessage removes the sender name everywhere, links, and is stable', () => {
    const r = redactMessage({
      id: 'x',
      from: 'Testy Fakebuyer <t@example.com>',
      subject: 'Hi from testy',
      body: 'Testy here, see https://x.example.com/d/tok. pay_TESTAAAA1111 and pay_TESTBBBB2222',
    });
    assertClean('redacted', r.text, PII);
    expect(r.text).toContain('[LINK]');
    expect(paymentPlaceholder(r.map)).toBe('[RAZORPAY_ID_1]');
    expect(r.map['[RAZORPAY_ID_1]']).toBe('pay_TESTAAAA1111');
    expect(paymentPlaceholder({ '[RAZORPAY_ID_1]': 'order_TESTAAAA1111' })).toBeUndefined();
  });

  it('inboxSetting: --inbox= wins over SUPPORT_INBOX', () => {
    expect(inboxSetting({ SUPPORT_INBOX: 'imap' }, ['node', 'x', '--inbox=file:/tmp/x'])).toBe(
      'file:/tmp/x',
    );
    expect(inboxSetting({ SUPPORT_INBOX: 'imap' }, [])).toBe('imap');
    expect(inboxSetting(undefined, [])).toBeUndefined();
  });
});

describe('main()', () => {
  it('no inbox configured → ok, nothing done', async () => {
    const logger = memoryLogger('support');
    const r = await main(testRunOptions('support', { logger }), { argv: [] });
    expect(r.status).toBe('ok');
    expect(logger.lines.some((l) => l.event === 'inbox.none')).toBe(true);
  });

  it('SUPPORT_INBOX=file:<dir>, no keys → keyword fallback, ok', async () => {
    const dir = tempInbox();
    const logger = memoryLogger('support');
    const r = await main(
      testRunOptions('support', {
        env: { DRY_RUN: 'true', SUPPORT_INBOX: `file:${dir}` },
        llm: fakeLlm([new LlmUnavailable([])]),
        logger,
      }),
      { argv: [] },
    );
    expect(r.status).toBe('ok');
    expect(r.result).toMatchObject({ handled: 6, escalated: 3 });
  });

  it('a real inbox that is not built yet → escalated (needs-owner), exit 0', async () => {
    const github = new MemoryGitHub({ agent: 'support', dryRun: true });
    const r = await main(testRunOptions('support', { github }), { argv: ['--inbox=gmail'] });
    expect(r.status).toBe('escalated');
    expect(github.issues[0]?.title).toMatch(/Support inbox not connected/);
  });

  it('accepts an injected inbox', async () => {
    const r = await main(testRunOptions('support'), {
      inbox: { fetchNew: async () => [], markHandled: async () => {}, sendReply: async () => {} },
    });
    expect(r.result).toMatchObject({ fetched: 0 });
  });
});
