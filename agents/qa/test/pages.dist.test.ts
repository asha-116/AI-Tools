/**
 * QA page check on the built site (agents/qa/PROCEDURE.md step 7). Needs `npm run build:site`
 * first. Without site/dist it skips — unless QA_REQUIRE_DIST=1 (CI), where it fails.
 * Run: `npm run qa:pages` (after building).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { strings } from '../../../site/src/i18n/strings.js';
import { templateStrings } from '../../../site/src/i18n/templates.js';
import { checkTemplatePage, checkToolPage } from '../src/pages.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DIST = join(ROOT, 'site/dist');
const TOOLS_SRC = join(ROOT, 'site/src/tools');
const LANGS = ['en', 'hi'] as const;
type Lang = (typeof LANGS)[number];

const hasDist = existsSync(join(DIST, 'index.html'));
const requireDist = process.env.QA_REQUIRE_DIST === '1';

/** Page path in dist for a route such as `tools/emi`. */
const pagePath = (lang: Lang, route: string) =>
  join(DIST, lang === 'en' ? '' : lang, route, 'index.html');

const subdirs = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory()) : [];

interface ToolTitles {
  formulaTitle: string;
  assumptionsTitle: string;
}

async function toolTitles(slug: string): Promise<Record<Lang, ToolTitles> | undefined> {
  const file = join(TOOLS_SRC, slug, 'strings.ts');
  if (!existsSync(file)) return undefined;
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  return Object.values(mod).find(
    (v): v is Record<Lang, ToolTitles> =>
      typeof v === 'object' &&
      v !== null &&
      LANGS.every((l) => typeof (v as Record<string, ToolTitles>)[l]?.formulaTitle === 'string'),
  );
}

if (!hasDist && !requireDist) {
  describe('QA page check (site/dist)', () => {
    it.skip('skipped: site/dist not found — run `npm run build:site`, then `npm run qa:pages`', () => {});
  });
} else {
  describe('QA page check (site/dist)', () => {
    it('site/dist exists (run npm run build:site first)', () => {
      expect(hasDist, 'site/dist/index.html is missing — run `npm run build:site`').toBe(true);
    });

    it('every tool page (EN + HI) shows the disclaimer, formula and assumptions', async () => {
      const problems: string[] = [];
      const slugs = [...new Set([...subdirs(TOOLS_SRC), ...subdirs(join(DIST, 'tools'))])].sort();
      expect(slugs.length).toBeGreaterThan(0);
      for (const slug of slugs) {
        const titles = await toolTitles(slug);
        for (const lang of LANGS) {
          const page = pagePath(lang, `tools/${slug}`);
          const where = `${lang === 'en' ? '' : `${lang}/`}tools/${slug}/`;
          if (!existsSync(page)) {
            problems.push(`${where}: page not built`);
            continue;
          }
          if (titles === undefined) {
            problems.push(`${where}: site/src/tools/${slug}/strings.ts has no formulaTitle`);
            continue;
          }
          const found = checkToolPage(readFileSync(page, 'utf8'), {
            lang,
            disclaimer: strings[lang].toolDisclaimer,
            formulaTitle: titles[lang].formulaTitle,
            assumptionsTitle: titles[lang].assumptionsTitle,
          });
          problems.push(...found.map((p) => `${where}: ${p}`));
        }
      }
      expect(problems).toEqual([]);
    });

    it('every template page (EN + HI) is "coming soon" with no price', () => {
      const problems: string[] = [];
      const ids = [
        ...new Set([
          ...Object.keys(templateStrings.en.pages),
          ...subdirs(join(DIST, 'templates')),
          ...subdirs(join(DIST, 'hi/templates')),
        ]),
      ].sort();
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        for (const lang of LANGS) {
          const page = pagePath(lang, `templates/${id}`);
          const where = `${lang === 'en' ? '' : `${lang}/`}templates/${id}/`;
          if (!existsSync(page)) {
            problems.push(`${where}: page not built`);
            continue;
          }
          const found = checkTemplatePage(readFileSync(page, 'utf8'), {
            lang,
            badge: templateStrings[lang].badge,
          });
          problems.push(...found.map((p) => `${where}: ${p}`));
        }
      }
      expect(problems).toEqual([]);
    });
  });
}
