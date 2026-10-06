/**
 * QA bilingual check (agents/qa/PROCEDURE.md step 6). Pure functions, no I/O.
 *
 * Finds every English/Hindi pair inside a value and checks it:
 * - `{ en, hi }` objects anywhere (module exports like `strings = { en, hi }`, spec columns);
 * - `<key>_en` / `<key>_hi` and `<key>` / `<key>_hi` string pairs (data files);
 * and, per pair: same keys both ways, same array lengths, same types, no string empty in only
 * one language, identical `{placeholders}`, and no English left in the Hindi text except the
 * allow-listed terms in agents/qa/allowed-latin.json.
 */

export interface Issue {
  file: string;
  path: string;
  message: string;
}

export interface Exemption {
  file: string;
  path: string;
  reason: string;
}

export interface BilingualRules {
  /** Latin-script words/phrases allowed in Hindi text (case-sensitive, whole words). */
  terms: readonly string[];
  /** Hindi strings deliberately written in English, by file + path. */
  exempt: readonly Exemption[];
  /** `<key>_hi` → English key when it is not `<key>_en` or `<key>` (e.g. state_name_hi → state). */
  pairAliases?: Readonly<Record<string, string>>;
}

const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g;
const URL = /https?:\/\/\S+/g;
const EMAIL = /\S+@\S+\.\S+/g;
/** Identifiers such as pay_ABC123 or 2BHK: anything with a digit or underscore. */
const CODE = /[A-Za-z0-9_]*[0-9_][A-Za-z0-9_]*/g;
/** A run of Latin words joined by spaces or hyphens. */
const LATIN_RUN = /[A-Za-z]+(?:[ -]+[A-Za-z]+)*/g;

export function placeholders(text: string): string[] {
  return (text.match(PLACEHOLDER) ?? []).sort();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** English runs left in `text` after removing allow-listed terms, codes, URLs and placeholders. */
export function latinLeftovers(text: string, terms: readonly string[]): string[] {
  let rest = text
    .replace(PLACEHOLDER, ' ')
    .replace(URL, ' ')
    .replace(EMAIL, ' ')
    .replace(CODE, ' ');
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    rest = rest.replace(new RegExp(`(?<![A-Za-z])${escapeRegExp(term)}(?![A-Za-z])`, 'g'), ' ');
  }
  // Single letters are formula variables (P, r, n), not untranslated text.
  return (rest.match(LATIN_RUN) ?? []).map((r) => r.trim()).filter((r) => r.length > 1);
}

type Json = unknown;

const typeName = (v: Json) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
const isPlainObject = (v: Json): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

/** Checks every English/Hindi pair found in `root`. `file` is used in issues and exemptions. */
export function checkBilingualValue(root: Json, file: string, rules: BilingualRules): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ file, path, message });
  const exempt = (path: string) => rules.exempt.some((e) => e.file === file && e.path === path);

  function comparePair(en: Json, hi: Json, path: string): void {
    const [te, th] = [typeName(en), typeName(hi)];
    if (te !== th) {
      add(path, `type differs: en ${te}, hi ${th}`);
      return;
    }
    if (typeof en === 'string' && typeof hi === 'string') {
      const [enEmpty, hiEmpty] = [en.trim() === '', hi.trim() === ''];
      if (enEmpty || hiEmpty) {
        // Empty in both languages means "intentionally absent" (e.g. an optional note).
        if (enEmpty !== hiEmpty) add(path, `empty in ${enEmpty ? 'en' : 'hi'}`);
        return;
      }
      const [pe, ph] = [placeholders(en), placeholders(hi)];
      if (pe.join() !== ph.join()) {
        add(path, `placeholders differ: en [${pe.join(', ')}], hi [${ph.join(', ')}]`);
      }
      if (!exempt(path)) {
        const left = latinLeftovers(hi, rules.terms);
        if (left.length > 0) {
          add(path, `English left in Hindi: ${left.map((r) => `"${r}"`).join(', ')}`);
        }
      }
      return;
    }
    if (Array.isArray(en) && Array.isArray(hi)) {
      if (en.length !== hi.length) {
        add(path, `array length differs: en ${en.length}, hi ${hi.length}`);
      }
      for (let i = 0; i < Math.min(en.length, hi.length); i++) {
        comparePair(en[i], hi[i], `${path}[${i}]`);
      }
      return;
    }
    if (isPlainObject(en) && isPlainObject(hi)) {
      for (const key of Object.keys(en)) {
        if (!(key in hi)) add(join(path, key), 'missing in hi');
      }
      for (const key of Object.keys(hi)) {
        if (!(key in en)) add(join(path, key), 'missing in en');
      }
      for (const key of Object.keys(en)) {
        if (key in hi) comparePair(en[key], hi[key], join(path, key));
      }
    }
    // Numbers, booleans and null of the same type need no translation.
  }

  function walk(node: Json, path: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (!isPlainObject(node)) return;

    const hasEn = 'en' in node;
    const hasHi = 'hi' in node;
    if (hasEn && hasHi) comparePair(node.en, node.hi, path);
    else if (hasEn) add(path, 'missing in hi');
    else if (hasHi) add(path, 'missing in en');

    const handled = new Set(['en', 'hi']);
    for (const [key, value] of Object.entries(node)) {
      if (typeof value !== 'string') continue;
      if (key.endsWith('_en')) {
        const hiKey = `${key.slice(0, -3)}_hi`;
        handled.add(key);
        if (typeof node[hiKey] !== 'string') add(join(path, key), `missing in hi (${hiKey})`);
      } else if (key.endsWith('_hi')) {
        const base = key.slice(0, -3);
        const enKey = [rules.pairAliases?.[key], `${base}_en`, base].find(
          (k): k is string => k !== undefined && typeof node[k] === 'string',
        );
        handled.add(key);
        if (enKey === undefined) add(join(path, key), `missing in en (${base}_en or ${base})`);
        else comparePair(node[enKey], value, join(path, key));
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (!handled.has(key)) walk(value, join(path, key));
    }
  }

  walk(root, '');
  return issues;
}

/** One line per issue, for test failure output and the PR comment. */
export function formatIssues(issues: readonly Issue[]): string[] {
  return issues.map((i) => `${i.file} › ${i.path || '(root)'}: ${i.message}`);
}
