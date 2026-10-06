// Support inbox adapters. A Message holds raw customer text: keep it in memory only — never
// write it to git, logs, Issues or an LLM prompt (redact first, see run.ts).

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Escalation } from '../../lib/src/index.js';

export interface Message {
  /** Stable id from the inbox (the Message-ID header for e-mail). Used for dedupe and replies. */
  id: string;
  /** Raw From header, e.g. `Asha Example <asha@example.com>`. PII. */
  from: string;
  subject: string;
  /** Plain-text body. PII. */
  body: string;
  receivedAt?: Date;
}

export interface Inbox {
  /** Messages not yet marked handled. */
  fetchNew(): Promise<Message[]>;
  /** Remember that a message is done (so the next run skips it). Live runs only. */
  markHandled(id: string): Promise<void>;
  /** Send a reply to the sender of message `id`. Live runs only. */
  sendReply(id: string, text: string): Promise<void>;
}

/**
 * Short reference for logs and Issues: a sha256 prefix of the message id, as `hhhhhh.hhhhhh`.
 * The dot keeps digit runs short so log scrubbing never mistakes a ref for a phone/Aadhaar number.
 */
export function messageRef(id: string): string {
  const hex = createHash('sha256').update(id).digest('hex');
  return `${hex.slice(0, 6)}.${hex.slice(6, 12)}`;
}

// ---------- parsing ----------

function headerMap(head: string): Map<string, string> {
  const map = new Map<string, string>();
  // Unfold continuation lines (RFC 5322 §2.2.3).
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m && !map.has((m[1] as string).toLowerCase())) {
      map.set((m[1] as string).toLowerCase(), (m[2] as string).trim());
    }
  }
  return map;
}

function splitHead(raw: string): [string, string] {
  const m = /\r?\n\r?\n/.exec(raw);
  return m ? [raw.slice(0, m.index), raw.slice(m.index + m[0].length)] : [raw, ''];
}

/** The text/plain part of a multipart body, or the body itself. */
function plainText(contentType: string, body: string): string {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (!/^multipart\//i.test(contentType) || !boundary) return body;
  for (const part of body.split(`--${boundary}`).slice(1)) {
    const [head, partBody] = splitHead(part.replace(/^\r?\n/, ''));
    const type = headerMap(head).get('content-type') ?? 'text/plain';
    if (/^text\/plain/i.test(type)) return partBody;
  }
  return '';
}

/**
 * Minimal RFC 5322 parser for plain-text test/dry-run fixtures: headers, unfolding, a
 * multipart text/plain part. No transfer decoding (quoted-printable / base64): a real inbox
 * adapter must hand over decoded text.
 */
export function parseEml(raw: string, fallbackId: string): Message {
  const [head, body] = splitHead(raw);
  const h = headerMap(head);
  const date = h.get('date') ? new Date(h.get('date') as string) : undefined;
  return {
    id: h.get('message-id') || fallbackId,
    from: h.get('from') ?? '',
    subject: h.get('subject') ?? '',
    body: plainText(h.get('content-type') ?? 'text/plain', body).trim(),
    ...(date && !Number.isNaN(date.getTime()) ? { receivedAt: date } : {}),
  };
}

function fromJson(value: unknown, fallbackId: string): Message {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const date = str('receivedAt') ? new Date(str('receivedAt')) : undefined;
  return {
    id: str('id') || fallbackId,
    from: str('from'),
    subject: str('subject'),
    body: str('body'),
    ...(date && !Number.isNaN(date.getTime()) ? { receivedAt: date } : {}),
  };
}

// ---------- file inbox (dry runs and tests) ----------

export type FileInbox = Inbox & {
  /** Replies "sent" in this process (memory only, never written to disk). */
  readonly sent: { id: string; text: string }[];
};

const STATE_FILE = '.handled.json';

/**
 * Reads `*.eml` and `*.json` (one message object or an array) from a local directory that is
 * NOT in git. Handled messages are remembered as message refs (hashes, not ids or text) in
 * `<dir>/.handled.json`. Replies are kept in memory only.
 */
export function fileInbox(dir: string): FileInbox {
  const statePath = join(dir, STATE_FILE);
  const handled = new Set<string>(
    existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as string[]) : [],
  );
  const sent: { id: string; text: string }[] = [];
  return {
    sent,
    async fetchNew() {
      const out: Message[] = [];
      for (const file of readdirSync(dir).sort()) {
        const raw = (): string => readFileSync(join(dir, file), 'utf8');
        if (file.endsWith('.eml')) out.push(parseEml(raw(), file));
        else if (file.endsWith('.json') && file !== STATE_FILE) {
          const parsed: unknown = JSON.parse(raw());
          const list = Array.isArray(parsed) ? parsed : [parsed];
          list.forEach((m, i) => out.push(fromJson(m, `${file}#${i}`)));
        }
      }
      return out.filter((m) => !handled.has(messageRef(m.id)));
    },
    async markHandled(id) {
      handled.add(messageRef(id));
      writeFileSync(statePath, `${JSON.stringify([...handled].sort(), null, 2)}\n`);
    },
    async sendReply(id, text) {
      sent.push({ id, text });
    },
  };
}

// ---------- real inbox: needs an owner decision ----------

/**
 * Placeholder for the real support inbox. Every call stops the run with an Escalation (a
 * deduplicated `needs-owner` Issue), so nothing is fetched or sent until the owner picks one:
 *
 * 1. **Gmail API via OAuth** — a Gmail/Workspace mailbox; a refresh token in Actions Secrets;
 *    plain `fetch` to the REST API (no new dependency); "handled" = a Gmail label.
 * 2. **Cloudflare Email Routing → Email Worker → D1 queue** — mail to support@ is parsed by a
 *    Worker into a D1 table; the agent reads/acks rows over an authenticated Worker API and
 *    replies via the Worker (`send_email` binding or the owner's SMTP relay). Free tier.
 * 3. IMAP would need a new library (not allowed without an owner-approved Issue, AGENTS.md
 *    rule 4) and an app password in Secrets — not recommended.
 */
export function imapInbox(kind: string): Inbox {
  const stop = (): never => {
    throw new Escalation({
      title: 'Support inbox not connected (needs owner decision)',
      context:
        `SUPPORT_INBOX is set to "${kind}", but no real inbox adapter exists yet, so the Support ` +
        'agent cannot read or answer mail. Nothing was fetched or sent.',
      options: [
        'Gmail API via OAuth: label-based "handled", refresh token in Actions Secrets, no new dependency.',
        'Cloudflare Email Routing → Email Worker → D1 queue read by the agent over a Worker API (free tier).',
        'Unset the SUPPORT_INBOX variable and answer support mail by hand for now.',
      ],
      recommendation:
        'Cloudflare Email Routing → Worker → D1: it keeps raw mail out of GitHub, costs nothing ' +
        'and fits the existing Workers. Until then, unset SUPPORT_INBOX so the job is skipped.',
      key: 'support-inbox-not-connected',
    });
  };
  return {
    fetchNew: async () => stop(),
    markHandled: async () => stop(),
    sendReply: async () => stop(),
  };
}

/**
 * Pick the inbox from `SUPPORT_INBOX` (or `--inbox=` on the command line):
 * `file:<dir>` → fileInbox (local only); any other non-empty value → imapInbox stub; empty →
 * undefined (nothing to do).
 */
export function inboxFromSetting(setting: string | undefined): Inbox | undefined {
  const value = (setting ?? '').trim();
  if (!value) return undefined;
  if (value.startsWith('file:')) return fileInbox(value.slice('file:'.length));
  return imapInbox(value);
}
