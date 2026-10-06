// PII redaction before any LLM call or log write (AGENTS.md rule 2).
//
// redact() swaps personal data for stable placeholders such as [EMAIL_1] and returns the map so
// the caller can put the real values back *locally* after the LLM call with restore().
// The map holds real PII: keep it in memory only — never log it, commit it or send it anywhere.
//
// Order matters: longer / more specific patterns run first so a shorter one cannot eat part of
// them (an email before a UPI id, a card before an Aadhaar number before a phone number).
// Rupee amounts (₹1,00,000), dates (06-10-2026, 2026-10-06) and times are left alone.

export type PiiKind =
  | 'EMAIL'
  | 'UPI'
  | 'RAZORPAY_ID'
  | 'GSTIN'
  | 'PAN'
  | 'IFSC'
  | 'CARD'
  | 'AADHAAR'
  | 'PHONE'
  | 'ADDRESS'
  | 'NAME';

/** Placeholder (e.g. "[EMAIL_1]") → original text. Contains real PII: memory only. */
export type RedactionMap = Record<string, string>;

export interface RedactOptions {
  /** Known names (customer, buyer…) to remove wherever they appear, case-insensitively. */
  names?: readonly string[];
  /** Continue an earlier map so the same value keeps the same placeholder across messages. */
  map?: RedactionMap;
}

export interface RedactResult {
  text: string;
  map: RedactionMap;
  /** How many distinct values of each kind were replaced — safe to log. */
  counts: Partial<Record<PiiKind, number>>;
}

// ASCII + Devanagari digits.
const D = '[0-9\\u0966-\\u096F]';
const D69 = '[6-9\\u096C-\\u096F]';
// Not right after a rupee sign / "Rs" / "INR": those digits are an amount, not an identifier.
const NOT_AMOUNT = '(?<!(?:₹|Rs\\.?|INR)\\s?)';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const UPI =
  /(?<![\w.@-])[A-Za-z0-9][\w.-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}(?![\w@-]|\.[A-Za-z0-9])/g;
const RAZORPAY_ID = /\b(?:pay|order|rfnd|setl|plink|cust|inv)_[A-Za-z0-9]{8,}\b/g;
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/gi;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi;
// 13–19 digits: contiguous, 4-4-4-x groups, or Amex 4-6-5. Mixed separators (dates) don't match.
const CARD =
  /(?<!\d)(?:\d{13,19}|\d{4}([ -])\d{4}\1\d{4}\1\d{1,4}(?:\1\d{1,3})?|\d{4}([ -])\d{6}\2\d{4,5})(?!\d)/g;
const AADHAAR = new RegExp(
  `(?<!${D})[2-9\\u0968-\\u096F]${D}{3}([ -]?)${D}{4}\\1${D}{4}(?!${D})`,
  'g',
);
const PHONE = new RegExp(
  `(?<!${D})${NOT_AMOUNT}` +
    `(?:(?:\\+|00)?(?:91|\\u096F\\u0967)[ -]?|\\(\\+?91\\)[ -]?|[0\\u0966][ -]?)?` +
    `${D69}(?:[ -]?${D}){9}(?!${D})`,
  'gi',
);
const PIN = new RegExp(`(?<!${D})${NOT_AMOUNT}[1-9\\u0967-\\u096F]${D}{2} ?${D}{3}(?!${D})`, 'i');
const ADDRESS_WORDS =
  /(?<![\p{L}\p{M}])(?:road|rd|street|st|nagar|colony|sector|flat|floor|apartments?|apt|society|lane|marg|chowk|near|opp|opposite|block|plot|house|h\.?\s?no|village|vill|district|dist|tehsil|taluka|pin|pincode|pin code|address|addr|tower|phase|layout|cross|main|मार्ग|नगर|गली|मकान|फ्लैट|पिन|पिनकोड|पता|ज़िला|जिला|सेक्टर|कॉलोनी|गाँव|गांव|मोहल्ला|रोड)(?![\p{L}\p{M}])/iu;
const ADDRESS_LABEL = /(?:address|addr|पता|पता है)\s*[:：–-]\s*/iu;

// Words that start a name. `capital`: following Latin words must be Capitalised.
const NAME_CUES: { re: RegExp; capital: boolean }[] = [
  {
    re: /(?<![\p{L}])(?:my name is|my name's|i am called|name\s*[:：–-]|naam\s*[:：–-]?|mera naam(?: hai)?|customer\s*[:：–-]|buyer\s*[:：–-]|from\s*[:：])[ \t]*/giu,
    capital: false,
  },
  {
    re: /(?<![\p{L}])(?:this is|regards,?|thanks(?: and regards)?,?|thank you,?|sincerely,?|yours (?:truly|sincerely|faithfully),?)\s*/giu,
    capital: true,
  },
  {
    re: /(?:मेरा नाम(?: है)?|नाम\s*[:：–-]|नाम है|मैं(?=\s+\S+(?:\s+\S+)?\s+बोल\s+रह))\s*/gu,
    capital: false,
  },
];
const NAME_TOKEN = /[\p{L}\p{M}]+(?:['’.-][\p{L}\p{M}]+)*\.?/uy;
const NAME_STOP = new Set(
  (
    "and i im i’m i'm from here the my me is am was want need would will have has had please pls " +
    'kindly sir madam ji or but with at in on of to for hai hu hoon hun aur se ka ki ke team ' +
    'है हूँ हूं हैं और से का की के था थी जी मैं मुझे ने को बोल'
  ).split(' '),
);
const LETTER_BOUNDARY_BEFORE = '(?<![\\p{L}\\p{M}\\p{N}_\\[])';
const LETTER_BOUNDARY_AFTER = '(?![\\p{L}\\p{M}\\p{N}_\\]])';

class Redactor {
  readonly map: RedactionMap;
  private readonly byValue = new Map<string, string>();
  private readonly next = new Map<PiiKind, number>();
  readonly counts: Partial<Record<PiiKind, number>> = {};

  constructor(map: RedactionMap = {}) {
    this.map = { ...map };
    for (const [ph, original] of Object.entries(this.map)) {
      const m = /^\[([A-Z_]+)_(\d+)\]$/.exec(ph);
      if (!m) continue;
      const kind = m[1] as PiiKind;
      this.byValue.set(key(kind, original), ph);
      this.next.set(kind, Math.max(this.next.get(kind) ?? 0, Number(m[2])));
    }
  }

  placeholder(kind: PiiKind, original: string): string {
    const k = key(kind, original);
    const existing = this.byValue.get(k);
    if (existing) return existing;
    const n = (this.next.get(kind) ?? 0) + 1;
    this.next.set(kind, n);
    const ph = `[${kind}_${n}]`;
    this.map[ph] = original;
    this.byValue.set(k, ph);
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    return ph;
  }

  replace(text: string, kind: PiiKind, re: RegExp): string {
    return text.replace(re, (m) => this.placeholder(kind, m));
  }
}

function key(kind: PiiKind, original: string): string {
  let norm = original.toLowerCase();
  if (kind === 'PHONE') norm = devanagariToAscii(original).replace(/\D/g, '').slice(-10);
  return `${kind}\u0000${norm}`;
}

function devanagariToAscii(s: string): string {
  return s.replace(/[०-९]/g, (c) => String((c.codePointAt(0) as number) - 0x966));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactAddresses(text: string, r: Redactor): string {
  return text
    .split('\n')
    .map((line) => {
      const pin = PIN.exec(line);
      if (!pin) return line;
      const commas = (line.match(/,/g) ?? []).length;
      if (!ADDRESS_WORDS.test(line) && commas < 2) return line;
      const label = ADDRESS_LABEL.exec(line);
      const start =
        label && label.index < pin.index
          ? label.index + label[0].length
          : (/^\s*/.exec(line) as RegExpExecArray)[0].length;
      const end = pin.index + pin[0].length;
      return (
        line.slice(0, start) + r.placeholder('ADDRESS', line.slice(start, end)) + line.slice(end)
      );
    })
    .join('\n');
}

/** Names that follow a cue ("my name is", "Name:", "Regards,", "मेरा नाम", "मैं … बोल रहा"). */
export function findCuedNames(text: string): string[] {
  const found: string[] = [];
  for (const { re, capital } of NAME_CUES) {
    re.lastIndex = 0;
    for (const cue of text.matchAll(re)) {
      const tokens: string[] = [];
      let pos = (cue.index as number) + cue[0].length;
      while (tokens.length < 3) {
        NAME_TOKEN.lastIndex = pos;
        const t = NAME_TOKEN.exec(text);
        if (!t) break;
        let word = t[0];
        // "Sharma." ends the sentence; "R." is an initial and the name goes on.
        const sentenceEnd = word.endsWith('.') && word.length > 2;
        if (sentenceEnd) word = word.slice(0, -1);
        if (NAME_STOP.has(word.toLowerCase())) break;
        if (capital && /^[a-z]/.test(word)) break;
        tokens.push(word);
        if (sentenceEnd) break;
        pos = t.index + t[0].length;
        const gap = /^[ \t]+/.exec(text.slice(pos));
        if (!gap) break;
        pos += gap[0].length;
      }
      if (tokens.length > 0) found.push(tokens.join(' '));
    }
  }
  return found;
}

function redactNames(text: string, names: readonly string[], r: Redactor): string {
  const all = new Set<string>();
  for (const n of [...names, ...findCuedNames(text)]) {
    const name = n.trim();
    if (name.length < 2) continue;
    all.add(name);
    for (const part of name.split(/\s+/)) {
      if (part.length >= 3 && !NAME_STOP.has(part.toLowerCase())) all.add(part);
    }
  }
  const sorted = [...all].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const re = new RegExp(
      `${LETTER_BOUNDARY_BEFORE}${escapeRe(name)}${LETTER_BOUNDARY_AFTER}`,
      'giu',
    );
    text = text.replace(re, (m) => r.placeholder('NAME', m));
  }
  return text;
}

/**
 * Replace personal data with stable placeholders ([EMAIL_1], [PHONE_1], [NAME_1]…).
 * The same value always gets the same placeholder within one map.
 */
export function redact(text: string, options: RedactOptions = {}): RedactResult {
  const r = new Redactor(options.map);
  let out = text;
  out = r.replace(out, 'EMAIL', EMAIL);
  out = r.replace(out, 'UPI', UPI);
  out = r.replace(out, 'RAZORPAY_ID', RAZORPAY_ID);
  out = r.replace(out, 'GSTIN', GSTIN);
  out = r.replace(out, 'PAN', PAN);
  out = r.replace(out, 'IFSC', IFSC);
  out = r.replace(out, 'CARD', CARD);
  out = r.replace(out, 'PHONE', PHONE);
  out = r.replace(out, 'AADHAAR', AADHAAR);
  out = redactAddresses(out, r);
  out = redactNames(out, options.names ?? [], r);
  return { text: out, map: r.map, counts: r.counts };
}

/** Put the original values back into (for example) an LLM reply. Unknown placeholders stay. */
export function restore(text: string, map: RedactionMap): string {
  let out = text;
  // An address may contain an earlier placeholder, so resolve nested ones too.
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/\[[A-Z_]+_\d+\]/g, (ph) => map[ph] ?? ph);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** True when redact() would change the text. Use to assert "redaction ran" before an LLM call. */
export function containsPii(text: string, options: Omit<RedactOptions, 'map'> = {}): boolean {
  return redact(text, options).text !== text;
}
