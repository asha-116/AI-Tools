import { describe, expect, it } from 'vitest';
import { ideas } from '../src/i18n/ideas.js';
import { LANGS, strings } from '../src/i18n/strings.js';

const DEVANAGARI = /[ऀ-ॿ]/;

describe('bilingual strings', () => {
  it('has identical, non-empty keys in every language', () => {
    const keys = Object.keys(strings.en).sort();
    for (const lang of LANGS) {
      expect(Object.keys(strings[lang]).sort()).toEqual(keys);
      for (const [k, v] of Object.entries(strings[lang])) {
        expect(v.trim(), `${lang}.${k}`).not.toBe('');
      }
    }
  });

  it('Hindi strings are actually in Devanagari (except the language switch)', () => {
    for (const [k, v] of Object.entries(strings.hi)) {
      if (k === 'langSwitchLabel') continue;
      expect(DEVANAGARI.test(v), `hi.${k}`).toBe(true);
    }
  });

  it('every idea has EN + HI title and summary', () => {
    expect(ideas).toHaveLength(3);
    for (const idea of ideas) {
      for (const lang of LANGS) {
        expect(idea.title[lang].trim()).not.toBe('');
        expect(idea.summary[lang].trim()).not.toBe('');
      }
      expect(DEVANAGARI.test(idea.title.hi)).toBe(true);
    }
  });

  it('idea ids are unique and URL-safe', () => {
    const ids = ideas.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});
