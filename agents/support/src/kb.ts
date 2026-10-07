// Reply templates from company/knowledge-base/. Templates are never sent to an LLM; their
// placeholders are filled locally from the redaction map after classification.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promptSections, restore, type RedactionMap } from '../../lib/src/index.js';

export const CATEGORIES = ['download_issue', 'refund_request', 'how_to', 'bug', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export type Language = 'en' | 'hi';

export interface Template {
  id: string;
  category: Category;
  product?: string;
  status: 'draft' | 'approved';
  text: Record<Language, string>;
}

export interface KnowledgeBase {
  templates: Template[];
  /** Per-language text used when a placeholder has no value. */
  defaults: Record<Language, Record<string, string>>;
}

export const KB_DIR = join('company', 'knowledge-base');

const META = /<!--\s*support-template\s*\n([\s\S]*?)-->/;

/** Parse one template file; returns undefined for files that are not templates. */
export function parseTemplate(markdown: string, file: string): Template | undefined {
  const meta = META.exec(markdown);
  if (!meta) return undefined;
  const fields: Record<string, string> = {};
  for (const line of (meta[1] as string).split('\n')) {
    const m = /^\s*([a-z_]+):\s*(\S+)/.exec(line);
    if (m) fields[m[1] as string] = m[2] as string;
  }
  const id = fields.id ?? '';
  const category = fields.category as Category;
  const status = fields.status;
  const sections = promptSections(markdown);
  const problems = [
    id === file.replace(/\.md$/, '') ? '' : `id "${id}" must match the file name`,
    CATEGORIES.includes(category) && category !== 'other' ? '' : `bad category "${category}"`,
    status === 'draft' || status === 'approved' ? '' : `bad status "${status}"`,
    sections.en ? '' : 'missing "## en"',
    sections.hi ? '' : 'missing "## hi"',
  ].filter(Boolean);
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return {
    id,
    category,
    ...(fields.product ? { product: fields.product } : {}),
    status: status as Template['status'],
    text: { en: sections.en as string, hi: sections.hi as string },
  };
}

/** `name: text` lines per language from placeholders.md. */
export function parseDefaults(markdown: string): KnowledgeBase['defaults'] {
  const sections = promptSections(markdown);
  const read = (s = ''): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of s.split('\n')) {
      const m = /^([a-z_]+):\s*(.+)$/.exec(line.trim());
      if (m) out[m[1] as string] = (m[2] as string).replace(/\\_/g, '_');
    }
    return out;
  };
  return { en: read(sections.en), hi: read(sections.hi) };
}

export function loadKnowledgeBase(repoRoot: string): KnowledgeBase {
  const dir = join(repoRoot, KB_DIR);
  const templates: Template[] = [];
  let defaults: KnowledgeBase['defaults'] = { en: {}, hi: {} };
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.md') || file === 'README.md') continue;
    const md = readFileSync(join(dir, file), 'utf8');
    if (file === 'placeholders.md') defaults = parseDefaults(md);
    else {
      const t = parseTemplate(md, file);
      if (t) templates.push(t);
    }
  }
  return { templates, defaults };
}

/** `{name}` placeholders used in a text, sorted and unique. */
export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1] as string))].sort();
}

/** The template for a category (how_to: the product's, else the general one). */
export function pickTemplate(
  kb: KnowledgeBase,
  category: Category,
  product: string | undefined,
): Template | undefined {
  const forCategory = kb.templates.filter((t) => t.category === category);
  return (
    forCategory.find((t) => product !== undefined && t.product === product) ??
    forCategory.find((t) => t.product === undefined)
  );
}

/**
 * Fill a template. `values` map placeholder names to redaction placeholders (e.g.
 * payment_id → "[RAZORPAY_ID_1]"); the real values come back only through restore() here,
 * locally. Missing values use the KB defaults.
 */
export function renderReply(
  kb: KnowledgeBase,
  template: Template,
  language: Language,
  values: Record<string, string | undefined>,
  map: RedactionMap,
): string {
  const filled = template.text[language].replace(/\{([a-z_]+)\}/g, (whole, name: string) => {
    const v = values[name] ?? kb.defaults[language][name];
    if (v === undefined) throw new Error(`template ${template.id}: no value for {${name}}`);
    return v;
  });
  return restore(filled, map);
}
