// Content rules shared by the SEO/Listing and Social agents (AGENTS.md §2, brand-voice.md).
// Pure functions: each returns human-readable problems (empty array = OK) so they can be fed
// back to the model as validation errors.

/** The only site agents may link to (AGENTS.md rule 10). */
export const SITE_ORIGIN = 'https://tools.changelense.in';

interface Rule {
  re: RegExp;
  reason: string;
}

/** brand-voice.md "Never": no superlatives / "official" / guarantees. */
const BANNED_WORDS: Rule[] = [
  { re: /\bguarantee(?:d|s)?\b/i, reason: 'uses "guarantee(d)"' },
  { re: /गारंटी|गारण्टी/, reason: 'uses "गारंटी" (guarantee)' },
  { re: /\bbest\b/i, reason: 'uses "best"' },
  { re: /सर्वश्रेष्ठ|सबसे अच्छा|बेस्ट/, reason: 'uses a Hindi "best" superlative' },
  { re: /\bofficial(?:ly)?\b/i, reason: 'uses "official"' },
  { re: /आधिकारिक|ऑफ़िशियल|ऑफिशियल/, reason: 'uses "आधिकारिक" (official)' },
  { re: /#\s?1\b|\bnumber one\b|\bno\.\s?1\b/i, reason: 'claims to be number one' },
];

/** No income promises (AGENTS.md, brand-voice.md). */
const INCOME_PROMISES: Rule[] = [
  {
    re: /\b(?:earn|make|making|earning)\b[^.!?\n]{0,30}(?:\b(?:money|income|lakhs?|crores?|thousands)\b|₹|\brs\.?\s?\d)/i,
    reason: 'promises earnings',
  },
  {
    re: /\b(?:passive|extra|guaranteed|assured|side)\s+(?:income|earnings|returns?)\b/i,
    reason: 'promises income',
  },
  { re: /\bget rich\b|\bdouble your\b|\bfinancial freedom\b/i, reason: 'promises wealth' },
  { re: /कमाई|कमाएँ|कमाएं|कमाइए|आमदनी|अमीर बन/, reason: 'promises earnings (Hindi)' },
];

/** Fear-based or fake urgency (brand-voice.md). */
const FAKE_URGENCY: Rule[] = [
  {
    re: /\b(?:hurry|act now|last chance|only today|today only|limited (?:time|offer|period|seats)|don'?t miss|before it'?s too late|ends (?:soon|tonight)|selling fast)\b/i,
    reason: 'fake urgency',
  },
  {
    re: /जल्दी करें|सीमित समय|आखिरी मौका|आख़िरी मौका|सिर्फ़? आज|केवल आज|आज ही|मौका न चूकें/,
    reason: 'fake urgency (Hindi)',
  },
];

/** Comparative claims about competitors always need the owner (SEO PROCEDURE escalation). */
const COMPETITORS =
  /\b(?:magicbricks|99acres|housing\.com|nobroker|squareyards|square yards|makaan|commonfloor|bankbazaar|paisabazaar|cleartax|groww|emicalculator\.net)\b/i;

/** News, politics and regulation changes need the owner (Social PROCEDURE escalation). */
const SENSITIVE_TOPICS: Rule[] = [
  {
    re: /\b(?:election|minister|government (?:announced|has announced)|new rule|amendment|notification|budget 20\d\d|repo rate|rbi (?:cut|hike|policy)|breaking news)\b/i,
    reason: 'news / politics / regulation change',
  },
  { re: /चुनाव|मंत्री|नया नियम|संशोधन|रेपो रेट|बजट 20\d\d/, reason: 'news / politics (Hindi)' },
];

function check(text: string, rules: Rule[]): string[] {
  return rules.filter((r) => r.re.test(text)).map((r) => r.reason);
}

/** Banned words + income promises. */
export function bannedPhrases(text: string): string[] {
  return [...check(text, BANNED_WORDS), ...check(text, INCOME_PROMISES)];
}

export function fakeUrgency(text: string): string[] {
  return check(text, FAKE_URGENCY);
}

export function competitorMentions(text: string): string[] {
  const m = COMPETITORS.exec(text);
  return m ? [`mentions competitor "${m[0]}"`] : [];
}

export function sensitiveTopics(text: string): string[] {
  return check(text, SENSITIVE_TOPICS);
}

/** "@someone" tags (people or brands). Email-like text is not a tag. */
export function personTags(text: string): string[] {
  return [...text.matchAll(/(?<![\w.])@[A-Za-z0-9_]{2,}(?:\.[A-Za-z0-9_]+)*/g)].map(
    (m) => `tags ${m[0]}`,
  );
}

const URL_RE = /\bhttps?:\/\/[^\s)<>\]"']+/gi;

/** Absolute links that do not point to our own site. */
export function externalLinks(text: string): string[] {
  return [...text.matchAll(URL_RE)]
    .map((m) => m[0].replace(/[.,;:!?]+$/, ''))
    .filter((u) => u !== SITE_ORIGIN && !u.startsWith(`${SITE_ORIGIN}/`));
}

const AMOUNT_RE =
  /(?:₹|\brs\.?|\binr)\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(lakh|lac|crore|cr|लाख|करोड़))?|(\d[\d,]*(?:\.\d+)?)\s?(lakh|lac|crore|लाख|करोड़)|(\d+(?:\.\d+)?)\s?%/gi;

function scale(unit: string | undefined): number {
  if (!unit) return 1;
  const u = unit.toLowerCase();
  if (u === 'lakh' || u === 'lac' || u === 'लाख') return 1e5;
  return 1e7; // crore / cr / करोड़
}

/**
 * Money amounts ("₹25,00,000", "Rs 5 lakh", "50 लाख") and percentages ("8.5%") whose value is
 * not in `allowed`. The models must never invent numbers: every figure comes from code.
 */
export function unverifiedNumbers(text: string, allowed: readonly number[]): string[] {
  const ok = (v: number) => allowed.some((a) => Math.abs(a - v) < 0.5 || Math.abs(a - v) < 1e-9);
  const out: string[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const raw = m[1] ?? m[3] ?? m[5];
    const value = Number(String(raw).replace(/,/g, '')) * scale(m[2] ?? m[4]);
    if (!ok(value)) out.push(`"${m[0].trim()}" is not a number computed by the tool`);
  }
  return out;
}

/** Word count that works for Hindi and English (tokens containing a letter or digit). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}
