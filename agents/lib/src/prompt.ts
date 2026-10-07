// prompt.md helpers. Prompts are read from the source tree (not dist/) so the build never has
// to copy Markdown.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read `agents/<agent>/<file>` relative to the repo root. */
export function readAgentFile(repoRoot: string, agent: string, file: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(agent) || file.split(/[\\/]/).some((p) => p === '..' || p === '')) {
    throw new Error(`invalid agent file "${agent}/${file}"`);
  }
  return readFileSync(join(repoRoot, 'agents', agent, file), 'utf8');
}

/**
 * Fill `{{name}}` slots. Every slot must have a value and every value must be used, so a
 * renamed variable fails loudly in tests instead of sending "{{name}}" to the model.
 */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  const used = new Set<string>();
  const out = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`template slot {{${name}}} has no value`);
    used.add(name);
    return String(vars[name]);
  });
  const unused = Object.keys(vars).filter((k) => !used.has(k));
  if (unused.length) throw new Error(`template values not used: ${unused.join(', ')}`);
  return out;
}

/**
 * Split a prompt.md into sections by `## name` headings, e.g. `## system` and `## user`.
 * Text before the first heading is ignored (use it for notes to humans).
 */
export function promptSections(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | undefined;
  const buf: string[] = [];
  const flush = (): void => {
    if (current !== undefined) out[current] = buf.join('\n').trim();
    buf.length = 0;
  };
  for (const line of markdown.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      current = (h[1] as string).toLowerCase();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}
