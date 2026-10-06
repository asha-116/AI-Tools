/**
 * QA checks on built pages (agents/qa/PROCEDURE.md step 7). Pure functions over HTML strings;
 * no parser dependency — the site is our own Astro output, so simple patterns are enough.
 *
 * - Tool pages: the disclaimer, a non-empty formula section and an assumptions list, all inside
 *   <main> (the footer's general disclaimer does not count).
 * - Template pages: no ₹ / Rs / INR price anywhere and the "coming soon" badge is shown
 *   (owner decision 2026-10-05: templates are "coming soon" with no price).
 */

export interface ToolPageExpect {
  lang: string;
  disclaimer: string;
  formulaTitle: string;
  assumptionsTitle: string;
}

export interface TemplatePageExpect {
  lang: string;
  badge: string;
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

/** Removes comments, scripts and styles: text there is not shown to the reader. */
export function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');
}

export function visibleText(html: string): string {
  return decodeEntities(stripNonContent(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlLang(html: string): string | undefined {
  return /<html\b[^>]*\blang="([^"]*)"/i.exec(html)?.[1];
}

function langProblem(html: string, lang: string): string[] {
  const actual = htmlLang(html);
  return actual === lang ? [] : [`<html lang> is "${actual ?? ''}", expected "${lang}"`];
}

/** HTML of the section that starts at the heading titled `title`, up to the next heading of the
 * same or a higher level. `undefined` when there is no such heading. */
function sectionAfterHeading(html: string, title: string): string | undefined {
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].map((m) => ({
    level: Number(m[1]),
    text: visibleText(m[2] ?? ''),
    start: m.index,
    end: m.index + m[0].length,
  }));
  const i = headings.findIndex((h) => h.text === title);
  const heading = headings[i];
  if (heading === undefined) return undefined;
  const next = headings.slice(i + 1).find((h) => h.level <= heading.level);
  return html.slice(heading.end, next?.start ?? html.length);
}

export function checkToolPage(html: string, expect: ToolPageExpect): string[] {
  const problems = langProblem(html, expect.lang);
  const main = /<main\b[^>]*>([\s\S]*)<\/main\s*>/i.exec(stripNonContent(html))?.[1];
  if (main === undefined) return [...problems, 'no <main> element'];

  if (!visibleText(main).includes(expect.disclaimer)) {
    problems.push(`disclaimer "${expect.disclaimer}" not found in <main>`);
  }

  const formula = sectionAfterHeading(main, expect.formulaTitle);
  if (formula === undefined) {
    problems.push(`formula section (heading "${expect.formulaTitle}") not found`);
  } else if (visibleText(formula) === '') {
    problems.push(`formula section "${expect.formulaTitle}" is empty`);
  }

  const assumptions = sectionAfterHeading(main, expect.assumptionsTitle);
  if (assumptions === undefined) {
    problems.push(`assumptions section (heading "${expect.assumptionsTitle}") not found`);
  } else {
    const items = [...assumptions.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)];
    if (!items.some((m) => visibleText(m[1] ?? '') !== '')) {
      problems.push(`assumptions section "${expect.assumptionsTitle}" has no list items`);
    }
  }
  return problems;
}

/** Rupee amounts (₹ 499, Rs. 299, INR 1,999) in text or attributes, outside scripts/styles.
 * A bare "₹" as a column unit, e.g. "Deal value (₹)", is not a price. */
export function findPrices(html: string): string[] {
  const text = decodeEntities(stripNonContent(html));
  return [...text.matchAll(/(?:₹|(?<![A-Za-z])(?:Rs\.?|INR))\s?\d[\d,]*/g)].map((m) => m[0]);
}

export function checkTemplatePage(html: string, expect: TemplatePageExpect): string[] {
  const problems = langProblem(html, expect.lang);
  for (const price of findPrices(html)) problems.push(`price shown: "${price}"`);
  const badges = [
    ...stripNonContent(html).matchAll(
      /<([a-z][a-z0-9]*)\b[^>]*\bclass="[^"]*\bbadge\b[^"]*"[^>]*>([\s\S]*?)<\/\1\s*>/gi,
    ),
  ];
  if (!badges.some((m) => visibleText(m[2] ?? '') === expect.badge)) {
    problems.push(`"coming soon" badge "${expect.badge}" not found`);
  }
  return problems;
}
