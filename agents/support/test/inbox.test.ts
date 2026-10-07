import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Escalation, redact } from '../../lib/src/index.js';
import { fileInbox, imapInbox, inboxFromSetting, messageRef, parseEml } from '../src/inbox.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'inbox');

function tempInbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'support-inbox-'));
  cpSync(FIXTURES, dir, { recursive: true });
  return dir;
}

describe('parseEml', () => {
  it('reads headers (folded), date and a plain body', () => {
    const m = parseEml(
      'Message-ID: <a@example.com>\r\nFrom: A <a@example.com>\r\nSubject: Hello\r\n  world\r\nDate: Tue, 06 Oct 2026 08:00:00 +0530\r\n\r\nBody text\r\n',
      'x.eml',
    );
    expect(m).toEqual({
      id: '<a@example.com>',
      from: 'A <a@example.com>',
      subject: 'Hello world',
      body: 'Body text',
      receivedAt: new Date('2026-10-06T02:30:00Z'),
    });
  });

  it('takes the text/plain part of a multipart message', () => {
    const m = parseEml(readFileSync(join(FIXTURES, '02-hi-refund.eml'), 'utf8'), 'f');
    expect(m.body).toContain('पैसे वापस');
    expect(m.body).not.toContain('html part');
  });

  it('falls back to the given id and ignores a bad date; header-only and odd input', () => {
    expect(parseEml('Subject: x\nDate: not a date', 'file.eml')).toEqual({
      id: 'file.eml',
      from: '',
      subject: 'x',
      body: '',
    });
    const noPlain = parseEml(
      'Content-Type: multipart/mixed; boundary=B\n\n--B\nContent-Type: text/html\n\n<p>x</p>\n--B--',
      'f',
    );
    expect(noPlain.body).toBe('');
    const defaultPart = parseEml(
      'Content-Type: multipart/mixed; boundary=B\n\n--B\nX-Other: 1\n\nplain by default\n--B--',
      'f',
    );
    expect(defaultPart.body).toContain('plain by default');
    expect(parseEml('Content-Type: multipart/mixed\n\nno boundary', 'f').body).toBe('no boundary');
  });
});

describe('messageRef', () => {
  it('is a stable 12-hex sha256 prefix with a dot', () => {
    expect(messageRef('<fake-0001@example.com>')).toMatch(/^[0-9a-f]{6}\.[0-9a-f]{6}$/);
    expect(messageRef('a')).toBe(messageRef('a'));
    expect(messageRef('a')).not.toBe(messageRef('b'));
  });

  it('is never mistaken for PII by log scrubbing', () => {
    for (let i = 0; i < 3000; i++) {
      const ref = messageRef(`id-${i}`);
      expect(redact(`ref ${ref}`).text).toBe(`ref ${ref}`);
    }
  });
});

describe('fileInbox', () => {
  it('reads .eml and .json (object or array) files in name order', async () => {
    const inbox = fileInbox(tempInbox());
    const msgs = await inbox.fetchNew();
    expect(msgs.map((m) => m.id)).toEqual([
      '<fake-0001@example.com>',
      '<fake-0002@example.com>',
      '<fake-0003@example.com>',
      '<fake-0004@example.com>',
      '<fake-0005@example.com>',
      '<fake-0006@example.com>',
      '<fake-0001@example.com>',
    ]);
    expect(msgs[2]?.receivedAt?.toISOString()).toBe('2026-10-06T04:00:00.000Z');
  });

  it('remembers handled messages as hashes only, across instances', async () => {
    const dir = tempInbox();
    const a = fileInbox(dir);
    await a.markHandled('<fake-0001@example.com>');
    const state = readFileSync(join(dir, '.handled.json'), 'utf8');
    expect(state).not.toContain('fake-0001');
    expect(JSON.parse(state)).toEqual([messageRef('<fake-0001@example.com>')]);
    const b = fileInbox(dir);
    const ids = (await b.fetchNew()).map((m) => m.id);
    expect(ids).not.toContain('<fake-0001@example.com>');
    expect(ids).toHaveLength(5);
  });

  it('keeps sent replies in memory only', async () => {
    const dir = tempInbox();
    const inbox = fileInbox(dir);
    await inbox.sendReply('<x>', 'hello');
    expect(inbox.sent).toEqual([{ id: '<x>', text: 'hello' }]);
    expect(existsSync(join(dir, 'outbox'))).toBe(false);
  });

  it('uses file#index ids and tolerates missing fields / non-objects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'support-inbox-'));
    writeFileSync(join(dir, 'a.json'), JSON.stringify([{ body: 'x', receivedAt: 'nope' }, 5]));
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    const msgs = await fileInbox(dir).fetchNew();
    expect(msgs).toEqual([
      { id: 'a.json#0', from: '', subject: '', body: 'x' },
      { id: 'a.json#1', from: '', subject: '', body: '' },
    ]);
  });
});

describe('imapInbox stub and inboxFromSetting', () => {
  it('every call escalates "needs owner decision"', async () => {
    const inbox = imapInbox('imap');
    for (const call of [
      () => inbox.fetchNew(),
      () => inbox.markHandled('x'),
      () => inbox.sendReply('x', 'y'),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(Escalation);
    }
    const err = await inbox.fetchNew().catch((e: Escalation) => e);
    expect((err as Escalation).request.key).toBe('support-inbox-not-connected');
    expect((err as Escalation).request.options.join(' ')).toMatch(/Gmail API.*Cloudflare Email/s);
  });

  it('picks the adapter from the setting', async () => {
    expect(inboxFromSetting(undefined)).toBeUndefined();
    expect(inboxFromSetting('  ')).toBeUndefined();
    const dir = tempInbox();
    expect(await inboxFromSetting(`file:${dir}`)?.fetchNew()).toHaveLength(7);
    await expect(inboxFromSetting('gmail')?.fetchNew()).rejects.toBeInstanceOf(Escalation);
  });
});
