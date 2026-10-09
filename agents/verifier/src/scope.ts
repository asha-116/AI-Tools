// Which parts of a PR the Verifier has to check (PROCEDURE "Trigger" + step 4). Pure functions.

export interface ChangedFile {
  filename: string;
  /** added | modified | removed | renamed | copied | changed | unchanged */
  status: string;
  /** Unified diff hunk(s); GitHub omits it for binary or very large files. */
  patch?: string;
  previous_filename?: string;
}

/** PRs touching these paths need a Verifier pass. */
export const IN_SCOPE_PREFIXES = [
  'tools-core/',
  'data/',
  'products/',
  'legal/',
  'company/policies/',
  'site/src/content/',
] as const;

/** Changes here need the `approved-by-owner` label (AGENTS.md rule 3). */
export const APPROVAL_PREFIXES = ['legal/', 'company/policies/'] as const;

export const APPROVAL_LABEL = 'approved-by-owner';

const TEXT_EXT = /\.(md|mdx|json|ya?ml|txt|csv|astro|html)$/i;
const PRICE_KEY = /"?\bprice(_inr|_paise)?\b"?\s*:/i;

export interface Scope {
  applicable: boolean;
  inScope: ChangedFile[];
  /** tools-core/src/** and known-answer fixtures. */
  formulaFiles: string[];
  /** In-scope text outside tools-core (claims check), not removed. */
  textFiles: ChangedFile[];
  /** Published site content (disclaimer check), not removed. */
  contentFiles: string[];
  /** Why the PR needs `approved-by-owner` (empty = it does not). */
  approvalReasons: string[];
}

const paths = (file: ChangedFile): string[] =>
  file.previous_filename ? [file.filename, file.previous_filename] : [file.filename];

const under = (prefixes: readonly string[]) => (file: ChangedFile) =>
  paths(file).some((p) => prefixes.some((pre) => p.startsWith(pre)));

export function isTextFile(name: string): boolean {
  return TEXT_EXT.test(name);
}

function diffLines(patch: string | undefined, sign: '+' | '-' | '+-'): string[] {
  if (!patch) return [];
  return patch
    .split('\n')
    .filter((l) => sign.includes(l.charAt(0)) && !l.startsWith('+++') && !l.startsWith('---'));
}

/** Text of the added lines of a unified diff, without the leading "+". */
export function addedLines(patch: string | undefined): string {
  return diffLines(patch, '+')
    .map((l) => l.slice(1))
    .join('\n');
}

/** True when an added or removed diff line sets a price key (price, price_inr, price_paise). */
export function priceChanged(file: ChangedFile): boolean {
  return diffLines(file.patch, '+-').some((l) => PRICE_KEY.test(l.slice(1)));
}

export function classify(files: readonly ChangedFile[]): Scope {
  const priced = files.filter(priceChanged);
  const inScope = files.filter((x) => under(IN_SCOPE_PREFIXES)(x) || priced.includes(x));
  const live = inScope.filter((x) => x.status !== 'removed');
  const formulaFiles = live
    .map((x) => x.filename)
    .filter(
      (n) =>
        (n.startsWith('tools-core/src/') && n.endsWith('.ts')) ||
        (n.startsWith('tools-core/test/fixtures/') && n.endsWith('.json')),
    );
  // READMEs explain how the repo works; the facts they describe live in the files they document.
  const textFiles = live.filter(
    (x) =>
      !x.filename.startsWith('tools-core/') &&
      isTextFile(x.filename) &&
      !/(^|\/)README\.md$/i.test(x.filename),
  );
  const contentFiles = textFiles
    .map((x) => x.filename)
    .filter((n) => n.startsWith('site/src/content/'));

  const approvalReasons: string[] = [];
  const legal = inScope
    .filter(under(APPROVAL_PREFIXES))
    .flatMap(paths)
    .filter((p) => APPROVAL_PREFIXES.some((pre) => p.startsWith(pre)));
  if (legal.length) approvalReasons.push(`touches legal/policy text: ${legal.join(', ')}`);
  if (priced.length)
    approvalReasons.push(`changes a price: ${priced.map((x) => x.filename).join(', ')}`);

  return {
    applicable: inScope.length > 0,
    inScope,
    formulaFiles,
    textFiles,
    contentFiles,
    approvalReasons,
  };
}

/**
 * The model family that produced the PR, from `<!-- producer-family: X -->` in its body
 * (the Builder writes it). Undefined when absent or "unknown".
 */
export function producerFamily(body: string): string | undefined {
  const m = /<!--\s*producer-family:\s*([A-Za-z0-9._-]+)\s*-->/.exec(body);
  const family = m?.[1]?.toLowerCase();
  return family && family !== 'unknown' ? family : undefined;
}
