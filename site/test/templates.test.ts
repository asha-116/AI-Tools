import { describe, expect, it } from 'vitest';
import { ideas } from '../src/i18n/ideas.js';
import { templateSpecs, templateStrings } from '../src/i18n/templates.js';
import {
  isTemplateId,
  notifyHref,
  sheetsFor,
  TEMPLATE_IDS,
  templatePath,
  type TemplateSpec,
} from '../src/lib/templates.js';

const DEVANAGARI = /[ऀ-ॿ]/;

/** Every key path in a nested string object, e.g. "pages.lead-tracker.h1". */
function keyPaths(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? keyPaths(v as object, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

function leaves(obj: object): [string, unknown][] {
  return keyPaths(obj).map((p) => [
    p,
    p.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj),
  ]);
}

describe('template strings', () => {
  it('has the same keys in EN and HI', () => {
    expect(keyPaths(templateStrings.hi).sort()).toEqual(keyPaths(templateStrings.en).sort());
  });

  it('has a page for every template id and nothing else', () => {
    for (const lang of ['en', 'hi'] as const) {
      expect(Object.keys(templateStrings[lang].pages).sort()).toEqual([...TEMPLATE_IDS].sort());
    }
  });

  it('values are non-empty (except an absent extra note) and Hindi is in Devanagari', () => {
    for (const lang of ['en', 'hi'] as const) {
      for (const [path, v] of leaves(templateStrings[lang])) {
        expect(typeof v, path).toBe('string');
        if (path === 'pages.lead-tracker.extraNote') continue;
        expect((v as string).trim(), `${lang}.${path}`).not.toBe('');
        if (lang === 'hi') expect(DEVANAGARI.test(v as string), `hi.${path}`).toBe(true);
      }
    }
  });

  it('shows no price anywhere (owner decision 2026-10-05)', () => {
    for (const lang of ['en', 'hi'] as const) {
      for (const [path, v] of leaves(templateStrings[lang])) {
        expect(v as string, `${lang}.${path}`).not.toMatch(/₹\s*\d|\bRs\.?\s*\d|\bINR\s*\d/i);
      }
    }
  });

  it('the commission ledger says GST is entered by you and TDS is not included', () => {
    expect(templateStrings.en.pages['commission-ledger'].extraNote).toMatch(/GST.*entered by you/);
    expect(templateStrings.en.pages['commission-ledger'].extraNote).toMatch(/TDS is not included/);
    expect(templateStrings.hi.pages['commission-ledger'].extraNote).toMatch(/GST/);
    expect(templateStrings.hi.pages['commission-ledger'].extraNote).toMatch(/TDS/);
  });
});

describe('template specs', () => {
  it('each spec matches its id and is a paid idea on the waitlist', () => {
    for (const id of TEMPLATE_IDS) {
      expect(templateSpecs[id].id).toBe(id);
      expect(ideas.find((i) => i.id === id)?.kind).toBe('paid');
    }
  });

  it('every sheet and column has EN + HI names', () => {
    for (const id of TEMPLATE_IDS) {
      for (const lang of ['en', 'hi'] as const) {
        const sheets = sheetsFor(templateSpecs[id], lang);
        expect(sheets.length).toBeGreaterThan(0);
        for (const sheet of sheets) {
          expect(sheet.title.trim()).not.toBe('');
          expect(sheet.purpose !== '' || sheet.columns.length > 0, sheet.id).toBe(true);
          for (const col of sheet.columns) expect(col.name.trim()).not.toBe('');
        }
      }
    }
  });

  it('marks formula columns as auto', () => {
    const deals = sheetsFor(templateSpecs['commission-ledger'], 'en').find((s) => s.id === 'deals');
    const auto = deals?.columns.filter((c) => c.auto).map((c) => c.name);
    expect(auto).toContain('Commission (₹)');
    expect(auto).toContain('Pending (₹)');
    expect(auto).not.toContain('Deal value (₹)');
  });
});

describe('sheetsFor', () => {
  const spec: TemplateSpec = {
    id: 'x',
    sheets: [
      {
        id: 'a',
        title: { en: 'A', hi: 'ए' },
        purpose: { en: 'Fill me', hi: 'भरें' },
        columns: [
          { id: 'c1', en: 'Typed', hi: 'लिखा', type: 'text' },
          { id: 'c2', en: 'Formula', hi: 'फ़ॉर्मूला', type: 'derived' },
        ],
      },
      { id: 'b', title: { en: 'B', hi: 'बी' } },
    ],
  };

  it('picks the language and marks derived columns', () => {
    expect(sheetsFor(spec, 'hi')).toEqual([
      {
        id: 'a',
        title: 'ए',
        purpose: 'भरें',
        columns: [
          { name: 'लिखा', auto: false },
          { name: 'फ़ॉर्मूला', auto: true },
        ],
      },
      { id: 'b', title: 'बी', purpose: '', columns: [] },
    ]);
  });
});

describe('paths', () => {
  it('builds template and notify links', () => {
    expect(templatePath('lead-tracker', 'en')).toBe('/templates/lead-tracker/');
    expect(templatePath('commission-ledger', 'hi')).toBe('/hi/templates/commission-ledger/');
    expect(notifyHref('lead-tracker', 'en')).toBe('/?idea=lead-tracker#waitlist');
    expect(notifyHref('commission-ledger', 'hi')).toBe('/hi/?idea=commission-ledger#waitlist');
  });

  it('knows which ids have a template page', () => {
    expect(isTemplateId('lead-tracker')).toBe(true);
    expect(isTemplateId('commission-ledger')).toBe(true);
    expect(isTemplateId('stamp-duty')).toBe(false);
    expect(isTemplateId('bundle')).toBe(false);
  });
});
