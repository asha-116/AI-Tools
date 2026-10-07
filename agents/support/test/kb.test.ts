import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redact } from '../../lib/src/index.js';
import {
  CATEGORIES,
  loadKnowledgeBase,
  parseDefaults,
  parseTemplate,
  pickTemplate,
  placeholdersOf,
  renderReply,
} from '../src/kb.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const kb = loadKnowledgeBase(ROOT);
const DEVANAGARI = /[\u0900-\u097F]/;

describe('knowledge-base templates (company/knowledge-base)', () => {
  it('has a template for every answerable category', () => {
    for (const c of CATEGORIES.filter((c) => c !== 'other')) {
      expect(pickTemplate(kb, c, undefined), c).toBeDefined();
    }
    expect(pickTemplate(kb, 'other', undefined)).toBeUndefined();
  });

  it('has a how-to template for every catalog product except the bundle', () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, 'products', 'catalog.json'), 'utf8')) as {
      products: { id: string }[];
    };
    for (const p of catalog.products.filter((p) => p.id !== 'bundle')) {
      expect(pickTemplate(kb, 'how_to', p.id)?.product, p.id).toBe(p.id);
    }
    expect(pickTemplate(kb, 'how_to', 'bundle')?.id).toBe('how-to-general');
  });

  it('EN/HI parity: both present, same placeholders, HI in Devanagari, EN not', () => {
    expect(kb.templates.length).toBeGreaterThanOrEqual(6);
    for (const t of kb.templates) {
      expect(t.text.en.length, t.id).toBeGreaterThan(100);
      expect(t.text.hi.length, t.id).toBeGreaterThan(100);
      expect(placeholdersOf(t.text.hi), t.id).toEqual(placeholdersOf(t.text.en));
      expect(DEVANAGARI.test(t.text.hi), t.id).toBe(true);
      expect(DEVANAGARI.test(t.text.en), t.id).toBe(false);
      for (const p of placeholdersOf(t.text.en)) {
        expect(kb.defaults.en[p], `${t.id} en default ${p}`).toBeTruthy();
        expect(kb.defaults.hi[p], `${t.id} hi default ${p}`).toBeTruthy();
      }
    }
  });

  it('contain no personal data and no unapproved promises of a refund', () => {
    for (const t of kb.templates) {
      for (const text of [t.text.en, t.text.hi]) {
        expect(redact(text).text, t.id).toBe(text);
        expect(text, t.id).not.toMatch(/we (?:will|have) refund/i);
      }
    }
  });

  it('download help points to /get-download/ and the 72-hour rule in both languages', () => {
    const t = pickTemplate(kb, 'download_issue', undefined);
    expect(t?.text.en).toContain('https://tools.changelense.in/get-download/');
    expect(t?.text.hi).toContain('https://tools.changelense.in/hi/get-download/');
    expect(t?.text.en).toContain('72 hours');
    expect(t?.text.hi).toContain('72 घंटे');
  });

  it('refund acknowledgement says "within 2 working days" and nothing more', () => {
    const t = pickTemplate(kb, 'refund_request', undefined);
    expect(t?.text.en).toContain('within 2\nworking days');
    expect(t?.text.hi).toContain('2 कामकाजी दिनों');
  });

  it('every shipped template is a draft until the owner approves it', () => {
    expect(kb.templates.every((t) => t.status === 'draft')).toBe(true);
  });
});

describe('renderReply', () => {
  const t = pickTemplate(kb, 'download_issue', undefined);
  if (!t) throw new Error('missing template');

  it('fills {payment_id} locally from the redaction map', () => {
    const { map } = redact('pay_TESTX7Q2ABCD');
    const text = renderReply(kb, t, 'en', { payment_id: '[RAZORPAY_ID_1]' }, map);
    expect(text).toContain('Payment ID: pay_TESTX7Q2ABCD');
    expect(text).not.toMatch(/\{|\[RAZORPAY/);
  });

  it('uses the language default when the value is missing', () => {
    expect(renderReply(kb, t, 'hi', { payment_id: undefined }, {})).toContain(
      kb.defaults.hi.payment_id,
    );
    expect(kb.defaults.en.payment_id).toContain('"pay_"');
  });

  it('throws on a placeholder with neither value nor default', () => {
    const bad = { ...t, text: { en: 'x {nope}', hi: 'x {nope}' } };
    expect(() => renderReply(kb, bad, 'en', {}, {})).toThrow(/no value for \{nope\}/);
  });
});

describe('parsing', () => {
  const good = (meta: string, body = '## en\n\nHello\n\n## hi\n\nनमस्ते') =>
    `# T\n\n<!-- support-template\n${meta}\n-->\n\n${body}\n`;

  it('ignores files without the marker', () => {
    expect(parseTemplate('# README', 'README.md')).toBeUndefined();
  });

  it('parses metadata', () => {
    expect(
      parseTemplate(good('id: x\ncategory: how_to\nproduct: p\nstatus: approved'), 'x.md'),
    ).toEqual({
      id: 'x',
      category: 'how_to',
      product: 'p',
      status: 'approved',
      text: { en: 'Hello', hi: 'नमस्ते' },
    });
  });

  it('rejects bad metadata and missing languages', () => {
    expect(() => parseTemplate(good('id: y\ncategory: how_to\nstatus: draft'), 'x.md')).toThrow(
      /match the file name/,
    );
    expect(() => parseTemplate(good('id: x\ncategory: other\nstatus: draft'), 'x.md')).toThrow(
      /bad category/,
    );
    expect(() => parseTemplate(good('id: x\ncategory: bug\nstatus: live'), 'x.md')).toThrow(
      /bad status/,
    );
    expect(() =>
      parseTemplate(good('id: x\ncategory: bug\nstatus: draft', '## en\n\nHi'), 'x.md'),
    ).toThrow(/missing "## hi"/);
    expect(() =>
      parseTemplate(good('category: bug\nstatus: draft', '## hi\n\nनमस्ते'), 'x.md'),
    ).toThrow(/missing "## en"/);
  });

  it('parses defaults and unescapes \\_', () => {
    expect(parseDefaults('## en\n\na_b: x \\_y\nnot a line\n\n## hi\n\na_b: य')).toEqual({
      en: { a_b: 'x _y' },
      hi: { a_b: 'य' },
    });
    expect(parseDefaults('nothing')).toEqual({ en: {}, hi: {} });
  });
});
