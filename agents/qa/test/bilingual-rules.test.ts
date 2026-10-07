import { describe, expect, it } from 'vitest';
import {
  checkBilingualValue,
  latinLeftovers,
  placeholders,
  type BilingualRules,
} from '../src/bilingual.js';

const rules: BilingualRules = {
  terms: ['EMI', 'GST', 'Google Sheets', 'WhatsApp', 'ID'],
  exempt: [{ file: 'x.ts', path: 'strings.langSwitchLabel', reason: 'test' }],
  pairAliases: { state_name_hi: 'state' },
};

const check = (value: unknown, file = 'x.ts') => checkBilingualValue(value, file, rules);

describe('placeholders', () => {
  it('returns {name} placeholders sorted, keeping duplicates', () => {
    expect(placeholders('{b} and {a} then {b}')).toEqual(['{a}', '{b}', '{b}']);
    expect(placeholders('no placeholders')).toEqual([]);
  });
});

describe('latinLeftovers', () => {
  it('ignores allow-listed terms, placeholders, single letters, URLs, e-mails and codes', () => {
    expect(
      latinLeftovers(
        'EMI = P × r, {date} तक Google Sheets में, https://example.com/a b@c.in pay_ABC123 देखें',
        rules.terms,
      ),
    ).toEqual([]);
  });

  it('reports untranslated English runs', () => {
    expect(latinLeftovers('यह Loan amount है और GST भी', rules.terms)).toEqual(['Loan amount']);
    expect(latinLeftovers('Read in English', rules.terms)).toEqual(['Read in English']);
  });

  it('matches terms case-sensitively and on whole words', () => {
    expect(latinLeftovers('emi और GSTIN', rules.terms)).toEqual(['emi', 'GSTIN']);
  });
});

describe('checkBilingualValue', () => {
  it('passes a well-formed { en, hi } module export', () => {
    expect(
      check({
        strings: {
          en: { a: 'Hello {name}', list: ['One', 'Two'], nested: { b: 'EMI' } },
          hi: { a: 'नमस्ते {name}', list: ['एक', 'दो'], nested: { b: 'EMI' } },
        },
      }),
    ).toEqual([]);
  });

  it('reports missing and extra keys in both directions', () => {
    const issues = check({ strings: { en: { a: 'A', b: 'B' }, hi: { a: 'ए', c: 'सी' } } });
    expect(issues).toEqual([
      { file: 'x.ts', path: 'strings.b', message: 'missing in hi' },
      { file: 'x.ts', path: 'strings.c', message: 'missing in en' },
    ]);
  });

  it('reports empty strings unless both languages are empty', () => {
    expect(check({ s: { en: { a: 'A', b: '' }, hi: { a: ' ', b: '' } } })).toEqual([
      { file: 'x.ts', path: 's.a', message: 'empty in hi' },
    ]);
  });

  it('reports array length and type mismatches', () => {
    expect(check({ s: { en: { l: ['a', 'b'], t: 'x' }, hi: { l: ['अ'], t: ['x'] } } })).toEqual([
      { file: 'x.ts', path: 's.l', message: 'array length differs: en 2, hi 1' },
      { file: 'x.ts', path: 's.t', message: 'type differs: en string, hi array' },
    ]);
  });

  it('reports placeholder mismatches', () => {
    expect(check({ s: { en: { a: 'Until {date}' }, hi: { a: '{data} तक' } } })).toEqual([
      {
        file: 'x.ts',
        path: 's.a',
        message: 'placeholders differ: en [{date}], hi [{data}]',
      },
    ]);
  });

  it('reports English left in Hindi, except exempt paths', () => {
    expect(
      check({
        strings: {
          en: { langSwitchLabel: 'हिन्दी में पढ़ें', lead: 'Monthly payment' },
          hi: { langSwitchLabel: 'Read in English', lead: 'Monthly payment' },
        },
      }),
    ).toEqual([
      {
        file: 'x.ts',
        path: 'strings.lead',
        message: 'English left in Hindi: "Monthly payment"',
      },
    ]);
    // The exemption is per file.
    expect(
      check(
        {
          strings: {
            en: { langSwitchLabel: 'हिन्दी' },
            hi: { langSwitchLabel: 'Read in English' },
          },
        },
        'other.ts',
      ),
    ).toHaveLength(1);
  });

  it('finds { en, hi } pairs nested anywhere in JSON (arrays, objects)', () => {
    const spec = {
      sheets: [
        {
          title: { en: 'Leads', hi: 'लीड' },
          columns: [
            { id: 'a', en: 'Name', hi: 'नाम' },
            { id: 'b', en: 'Phone', hi: 'Phone' },
            { id: 'c', en: 'Source' },
            { id: 'd', hi: 'स्रोत' },
            { id: 'e', en: 'WhatsApp', hi: 'WhatsApp' },
          ],
        },
      ],
      version: 1,
    };
    expect(check(spec, 'spec.json')).toEqual([
      {
        file: 'spec.json',
        path: 'sheets[0].columns[1]',
        message: 'English left in Hindi: "Phone"',
      },
      { file: 'spec.json', path: 'sheets[0].columns[2]', message: 'missing in hi' },
      { file: 'spec.json', path: 'sheets[0].columns[3]', message: 'missing in en' },
    ]);
  });

  it('pairs <key>_en / <key>_hi and <key> / <key>_hi in JSON', () => {
    const data = {
      state: 'Maharashtra',
      state_name_hi: 'महाराष्ट्र',
      areas: [
        { id: 'm', label_en: 'Mumbai', label_hi: 'मुंबई' },
        { id: 'p', label_en: 'Pune' },
      ],
      rates: [
        { description: 'Woman buyer', description_hi: 'Woman buyer' },
        { name: 'Cess', name_hi: 'सेस' },
        { orphan_hi: 'अनाथ' },
      ],
    };
    expect(check(data, 'MH.json')).toEqual([
      { file: 'MH.json', path: 'areas[1].label_en', message: 'missing in hi (label_hi)' },
      {
        file: 'MH.json',
        path: 'rates[0].description_hi',
        message: 'English left in Hindi: "Woman buyer"',
      },
      {
        file: 'MH.json',
        path: 'rates[2].orphan_hi',
        message: 'missing in en (orphan_en or orphan)',
      },
    ]);
  });

  it('ignores non-string _en/_hi values (e.g. JSON Schema property definitions)', () => {
    expect(check({ properties: { label_en: { type: 'string' } } }, 'schema.json')).toEqual([]);
  });
});
