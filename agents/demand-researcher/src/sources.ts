// Research sources (agents/demand-researcher/sources.json). Only allow-listed source TYPES exist,
// every source is disabled until the owner has read its terms (`terms_checked: true`), and a
// source cannot be enabled without that flag.

import { z } from 'zod';

/** Source types the agent may use at all. Forums/scraping are deliberately not a type. */
export const ALLOWED_TYPES = ['autocomplete'] as const;

export const SourceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    type: z.enum(ALLOWED_TYPES),
    name: z.string().min(1),
    /** https URL with {q} (query) and optional {hl} (language) slots. */
    url_template: z
      .string()
      .startsWith('https://')
      .refine((u) => u.includes('{q}'), 'url_template needs a {q} slot'),
    format: z.enum(['opensearch', 'ddg']),
    languages: z.array(z.enum(['en', 'hi'])).min(1),
    terms_url: z.url(),
    terms_checked: z.boolean(),
    enabled: z.boolean(),
    notes: z.string().default(''),
  })
  .refine((s) => !s.enabled || s.terms_checked, {
    message: 'a source can be enabled only after its terms are checked (terms_checked: true)',
  });

export type Source = z.infer<typeof SourceSchema>;

export function loadSources(json: string): Source[] {
  return z.object({ sources: z.array(SourceSchema) }).parse(JSON.parse(json)).sources;
}

export function enabledSources(sources: readonly Source[]): Source[] {
  return sources.filter((s) => s.enabled && s.terms_checked);
}

export function sourceUrl(source: Source, q: string, lang: 'en' | 'hi'): string {
  return source.url_template
    .replaceAll('{q}', encodeURIComponent(q))
    .replaceAll('{hl}', encodeURIComponent(lang));
}

export function sourceOrigin(source: Source): string {
  return new URL(source.url_template.replaceAll('{q}', 'x').replaceAll('{hl}', 'en')).origin;
}

/** Suggestions from a response body; [] for anything unexpected. At most 10. */
export function parseSuggestions(format: Source['format'], body: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  let out: unknown[] = [];
  if (format === 'opensearch' && Array.isArray(data) && Array.isArray(data[1])) out = data[1];
  if (format === 'ddg' && Array.isArray(data)) {
    out = data.map((d: unknown) =>
      d && typeof d === 'object' ? (d as { phrase?: unknown }).phrase : d,
    );
  }
  return out
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => s.trim().slice(0, 200))
    .slice(0, 10);
}
