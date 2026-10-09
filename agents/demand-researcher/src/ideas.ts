// Pure helpers: query seeds, PII stripping, scoring, de-duplication and escalation flags.

import { redact } from '../../lib/src/index.js';

export type Lang = 'en' | 'hi';
export interface Seed {
  q: string;
  lang: Lang;
}

const PROFESSION: Seed[] = [
  { q: 'real estate agent', lang: 'en' },
  { q: 'property dealer', lang: 'en' },
  { q: 'property broker', lang: 'en' },
  { q: 'प्रॉपर्टी डीलर', lang: 'hi' },
  { q: 'रियल एस्टेट एजेंट', lang: 'hi' },
];
const SUFFIX: Record<Lang, string[]> = {
  en: ['calculator', 'excel template', 'app'],
  hi: ['कैलकुलेटर'],
};

/** Lower-case, drop punctuation except Devanagari marks, squeeze spaces. */
function clean(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Query seeds from the profession + existing tools/ideas, EN + HI, de-duplicated, at most `max`.
 * Order: tool/idea names first (most specific), then profession × suffix.
 */
export function buildSeeds(names: { en: string; hi: string }[], max = 24): Seed[] {
  const out: Seed[] = [];
  const seen = new Set<string>();
  const add = (q: string, lang: Lang) => {
    const c = clean(q);
    if (c && !seen.has(`${lang}:${c}`)) {
      seen.add(`${lang}:${c}`);
      out.push({ q: c, lang });
    }
  };
  // Broad profession seeds first: they find new ideas, and must not be crowded out as the
  // number of tools grows. Tool and waitlist names fill the rest.
  for (const p of PROFESSION) for (const s of SUFFIX[p.lang]) add(`${p.q} ${s}`, p.lang);
  for (const n of names) {
    add(n.en, 'en');
    add(n.hi, 'hi');
  }
  return out.slice(0, max);
}

/**
 * Remove usernames/handles and personal data from public text before it reaches an LLM:
 * @handles, u/name, /user/name, "posted by X", then the shared PII redactor.
 */
export function sanitize(text: string): string {
  const stripped = text
    .replace(/(?<![\w.])@[A-Za-z0-9_]{2,}(?:\.[A-Za-z0-9_]+)*/g, '[USER]')
    .replace(/\bu\/[A-Za-z0-9_-]+/g, '[USER]')
    .replace(/\/user(?:s)?\/[A-Za-z0-9_.-]+/gi, '/user/[USER]')
    .replace(/\b(posted|asked|answered|written) by\s+\S+/gi, '$1 by [USER]');
  return redact(stripped).text;
}

export interface Scores {
  demand: number;
  effort: number;
  uniqueness: number;
}

/**
 * PROCEDURE step 4: each score is 1–5 (effort is inverted: 5 = least effort);
 * total = demand × 2 + effort + uniqueness (range 4–20).
 */
export function totalScore(s: Scores): number {
  for (const [k, v] of Object.entries(s)) {
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new RangeError(`${k} must be 1–5`);
  }
  return s.demand * 2 + s.effort + s.uniqueness;
}

const STOP = new Set([
  'a',
  'an',
  'and',
  'the',
  'for',
  'of',
  'with',
  'to',
  'in',
  'on',
  'free',
  'tool',
  'tools',
  'india',
  'indian',
  'online',
  'simple',
  'और',
  'के',
  'का',
  'की',
  'लिए',
]);

export function titleTokens(title: string): Set<string> {
  return new Set(
    clean(title)
      .split(' ')
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Stable key for an idea (sorted tokens), used in a hidden Issue marker. */
export function ideaKey(title: string): string {
  return [...titleTokens(title)].sort().join('-').slice(0, 80);
}

/** Same idea when ≥ 75% of the shorter title's tokens appear in the other. */
export function isDuplicate(title: string, existing: readonly string[]): boolean {
  const a = titleTokens(title);
  return existing.some((e) => {
    const b = titleTokens(e);
    const small = a.size <= b.size ? a : b;
    const large = small === a ? b : a;
    if (small.size === 0) return false;
    const shared = [...small].filter((t) => large.has(t)).length;
    return shared / small.size >= 0.75;
  });
}

const ESCALATE: { re: RegExp; reason: string }[] = [
  {
    re: /\b(?:legal advice|tax advice|tax filing|income tax return|itr filing|investment advice)\b|कानूनी सलाह|टैक्स सलाह|निवेश सलाह/i,
    reason: 'involves legal/tax/investment advice',
  },
  {
    re: /\b(?:loan brokering|loan broker|dsa|insurance|mutual funds?|lending|credit score repair)\b|लोन ब्रोकर|बीमा/i,
    reason: 'involves a regulated activity',
  },
];

/** Why an idea needs the owner (PROCEDURE escalation rule), or [] when it does not. */
export function escalationReasons(text: string): string[] {
  const out = ESCALATE.filter((e) => e.re.test(text)).map((e) => e.reason);
  const prices = [...text.matchAll(/(?:₹|\brs\.?\s?|\binr\s?)(\d[\d,]*)/gi)].map((m) =>
    Number((m[1] as string).replace(/,/g, '')),
  );
  if (prices.some((p) => p > 999)) out.push('mentions a price above ₹999');
  return out;
}
