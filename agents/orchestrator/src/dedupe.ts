// PROCEDURE step 3: drop candidates that duplicate an open Issue (or each other).
// Similarity = Jaccard index of normalised title words; labels lower the bar.

export interface Titled {
  title: string;
  labels: readonly string[];
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/** Conventional-commit or bracketed prefixes such as `feat:`, `fix(site):`, `[agent]`. */
const PREFIX = /^\s*(?:\[[^\]]*\]\s*|[a-z]+(?:\([^)]*\))?!?:\s*)+/i;

/** Lower-case words (letters/digits in any script), no prefix, no stopwords, naive singular. */
export function normaliseTitle(title: string): string[] {
  const words = title
    .replace(PREFIX, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  return [...new Set(words)];
}

/** Jaccard similarity of the normalised word sets, 0–1. Two empty titles are not similar. */
export function titleSimilarity(a: string, b: string): number {
  const x = new Set(normaliseTitle(a));
  const y = new Set(normaliseTitle(b));
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** Same title words → duplicate; mostly the same words and a shared agent/type label → duplicate. */
export const SAME_TITLE = 0.8;
export const SIMILAR_TITLE = 0.5;

function sharesRoutingLabel(a: readonly string[], b: readonly string[]): boolean {
  return a.some((l) => (l.startsWith('agent:') || l.startsWith('type:')) && b.includes(l));
}

/** The first existing item `c` duplicates, or undefined. */
export function findDuplicate<T extends Titled>(c: Titled, existing: readonly T[]): T | undefined {
  return existing.find((e) => {
    const s = titleSimilarity(c.title, e.title);
    return s >= SAME_TITLE || (s >= SIMILAR_TITLE && sharesRoutingLabel(c.labels, e.labels));
  });
}

export interface Deduped<C, E> {
  kept: C[];
  dropped: { candidate: C; duplicateOf: E | C }[];
}

/** Keep candidates that duplicate neither an open Issue nor an earlier kept candidate. */
export function dedupe<C extends Titled, E extends Titled>(
  candidates: readonly C[],
  open: readonly E[],
): Deduped<C, E> {
  const kept: C[] = [];
  const dropped: Deduped<C, E>['dropped'] = [];
  for (const c of candidates) {
    const dup = findDuplicate(c, open) ?? findDuplicate(c, kept);
    if (dup) dropped.push({ candidate: c, duplicateOf: dup });
    else kept.push(c);
  }
  return { kept, dropped };
}
