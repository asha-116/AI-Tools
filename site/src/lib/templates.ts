/** Pure helpers for the template "coming soon" pages and the waitlist idea pre-select. */

export type PageLang = 'en' | 'hi';

/** Templates that have a "what's inside" page under /templates/<id>/. */
export const TEMPLATE_IDS = ['lead-tracker', 'commission-ledger'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function isTemplateId(id: string): id is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(id);
}

/** The part of products/<id>/spec.json the pages read. Extra fields are ignored. */
export interface SpecColumn {
  id: string;
  en: string;
  hi: string;
  type: string;
}

export interface SpecSheet {
  id: string;
  title: Record<PageLang, string>;
  purpose?: Record<PageLang, string>;
  columns?: readonly SpecColumn[];
}

export interface TemplateSpec {
  id: string;
  sheets: readonly SpecSheet[];
}

export interface ColumnView {
  name: string;
  /** True for formula columns that fill themselves (grey in the sheet). */
  auto: boolean;
}

export interface SheetView {
  id: string;
  title: string;
  purpose: string;
  columns: ColumnView[];
}

/** Sheets with their title, purpose and column names in one language. */
export function sheetsFor(spec: TemplateSpec, lang: PageLang): SheetView[] {
  return spec.sheets.map((sheet) => ({
    id: sheet.id,
    title: sheet.title[lang],
    purpose: sheet.purpose?.[lang] ?? '',
    columns: (sheet.columns ?? []).map((c) => ({ name: c[lang], auto: c.type === 'derived' })),
  }));
}

/** Path of a template page, e.g. "/templates/lead-tracker/" or "/hi/templates/lead-tracker/". */
export function templatePath(id: TemplateId, lang: PageLang): string {
  return `${lang === 'hi' ? '/hi' : ''}/templates/${id}/`;
}

/** Home-page waitlist link with this idea pre-selected. */
export function notifyHref(id: string, lang: PageLang): string {
  return `${lang === 'hi' ? '/hi/' : '/'}?idea=${encodeURIComponent(id)}#waitlist`;
}

/**
 * The idea id from a URL query string ("?idea=lead-tracker"), but only if it is one of `known`
 * (the radios on the page). Anything else gives null, so the default choice stays.
 */
export function ideaFromSearch(search: string, known: readonly string[]): string | null {
  const id = new URLSearchParams(search).get('idea');
  return id !== null && known.includes(id) ? id : null;
}
