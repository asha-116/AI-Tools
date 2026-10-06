/**
 * QA bilingual check on the real repo (agents/qa/PROCEDURE.md step 6). Runs with `npm test` and
 * as its own CI step. Every failure names the file and the key path.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import rulesFile from '../allowed-latin.json' with { type: 'json' };
import {
  checkBilingualValue,
  formatIssues,
  type BilingualRules,
  type Issue,
} from '../src/bilingual.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const rules: BilingualRules = rulesFile;
const rel = (p: string) => relative(ROOT, p).split('\\').join('/');

function filesIn(dir: string, pick: (name: string) => boolean): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .map((name) => join(abs, name))
    .flatMap((p) => (statSync(p).isDirectory() ? filesIn(rel(p), pick) : pick(p) ? [p] : []))
    .sort();
}

const toolDirs = readdirSync(join(ROOT, 'site/src/tools'))
  .filter((d) => statSync(join(ROOT, 'site/src/tools', d)).isDirectory())
  .sort();

const tsModules = [
  ...filesIn('site/src/i18n', (p) => p.endsWith('.ts')),
  ...toolDirs.map((d) => join(ROOT, 'site/src/tools', d, 'strings.ts')),
];

const jsonFiles = [
  ...filesIn('products', (p) => p.endsWith('.json')),
  ...filesIn('data', (p) => p.endsWith('.json')),
].filter((p) => !/schema\.json$/.test(p));

const isLangPair = (v: unknown) => typeof v === 'object' && v !== null && 'en' in v && 'hi' in v;

describe('QA bilingual check', () => {
  it('finds the string modules and data files', () => {
    expect(tsModules.length).toBeGreaterThanOrEqual(4);
    expect(jsonFiles.length).toBeGreaterThanOrEqual(3);
  });

  it('every allow-list exemption has a reason', () => {
    for (const e of rules.exempt) expect(e.reason.trim(), `${e.file} ${e.path}`).not.toBe('');
  });

  it('TS string modules: EN and HI match, Hindi is Hindi', async () => {
    const issues: Issue[] = [];
    for (const file of tsModules) {
      const name = rel(file);
      if (!existsSync(file)) {
        issues.push({ file: name, path: '', message: 'tool has no strings.ts' });
        continue;
      }
      const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      const exports = { ...mod };
      if (name.endsWith('/strings.ts') && !Object.values(exports).some(isLangPair)) {
        issues.push({ file: name, path: '', message: 'no { en, hi } export found' });
      }
      issues.push(...checkBilingualValue(exports, name, rules));
    }
    expect(formatIssues(issues)).toEqual([]);
  });

  it('JSON data/spec files: every _en/_hi and { en, hi } pair matches', () => {
    const issues: Issue[] = [];
    for (const file of jsonFiles) {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
      issues.push(...checkBilingualValue(data, rel(file), rules));
    }
    expect(formatIssues(issues)).toEqual([]);
  });
});
