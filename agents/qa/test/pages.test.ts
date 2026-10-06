import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTemplatePage, checkToolPage, findPrices, visibleText } from '../src/pages.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const toolEn = fixture('tool-en.html');
const templateHi = fixture('template-hi.html');

const toolExpect = {
  lang: 'en',
  disclaimer: 'For estimation only — verify with a professional.',
  formulaTitle: 'How it is calculated',
  assumptionsTitle: 'Assumptions',
} as const;

const templateExpect = { lang: 'hi', badge: 'जल्द आ रहा है' } as const;

describe('visibleText', () => {
  it('drops tags, scripts, styles and comments, decodes entities and collapses spaces', () => {
    expect(
      visibleText(
        '<p>A &amp; B&nbsp;&#8377;5 &#x20B9;6 &quot;q&quot; &lt;x&gt; &#39;s&#39;</p><!-- hidden --><script>bad()</script><style>.bad{}</style>\n<p>C</p>',
      ),
    ).toBe('A & B ₹5 ₹6 "q" <x> \'s\' C');
  });
});

describe('checkToolPage', () => {
  it('passes a page with disclaimer, formula and assumptions inside <main>', () => {
    expect(checkToolPage(toolEn, toolExpect)).toEqual([]);
  });

  it('fails when the disclaimer is only in the footer, a script or a style', () => {
    const html = toolEn.replace(
      '<strong>For estimation only — verify with a professional.</strong>',
      '',
    );
    expect(checkToolPage(html, toolExpect)).toEqual([
      'disclaimer "For estimation only — verify with a professional." not found in <main>',
    ]);
  });

  it('fails when the formula section is missing or empty', () => {
    expect(checkToolPage(toolEn.replace('How it is calculated', 'Maths'), toolExpect)).toEqual([
      'formula section (heading "How it is calculated") not found',
    ]);
    const empty = toolEn.replace(/<p class="formula">[\s\S]*?instalments\.<\/p>/, '');
    expect(checkToolPage(empty, toolExpect)).toEqual([
      'formula section "How it is calculated" is empty',
    ]);
  });

  it('fails when the assumptions section has no list items', () => {
    const html = toolEn.replace(/<ul>[\s\S]*?<\/ul>/, '<p>None.</p>');
    expect(checkToolPage(html, toolExpect)).toEqual([
      'assumptions section "Assumptions" has no list items',
    ]);
    expect(checkToolPage(toolEn.replace('>Assumptions<', '>Notes<'), toolExpect)).toEqual([
      'assumptions section (heading "Assumptions") not found',
    ]);
  });

  it('fails on the wrong language or a missing <main>', () => {
    expect(checkToolPage(toolEn, { ...toolExpect, lang: 'hi' })).toContain(
      '<html lang> is "en", expected "hi"',
    );
    expect(checkToolPage('<html lang="en"><body>x</body></html>', toolExpect)).toEqual([
      'no <main> element',
    ]);
  });
});

describe('findPrices', () => {
  it('finds rupee amounts in text and attributes, not bare ₹ column units', () => {
    expect(findPrices(templateHi)).toEqual([]);
    expect(
      findPrices(
        '<p>Only ₹ 499!</p><meta content="Rs. 299"><p>INR 1,999 &#8377;99 Rs.49 ₹ (paid)</p><script>"₹1"</script>',
      ),
    ).toEqual(['₹ 499', 'Rs. 299', 'INR 1,999', '₹99', 'Rs.49']);
  });
});

describe('checkTemplatePage', () => {
  it('passes a coming-soon page without a price', () => {
    expect(checkTemplatePage(templateHi, templateExpect)).toEqual([]);
  });

  it('fails when a price appears', () => {
    const html = templateHi.replace('अभी कोई कीमत तय नहीं है।', 'कीमत ₹499');
    expect(checkTemplatePage(html, templateExpect)).toEqual(['price shown: "₹499"']);
  });

  it('fails when the coming-soon badge is missing or reworded', () => {
    const missing = templateHi.replace(/<p class="badge"[^>]*>.*?<\/p>/, '');
    expect(checkTemplatePage(missing, templateExpect)).toEqual([
      '"coming soon" badge "जल्द आ रहा है" not found',
    ]);
    const reworded = templateHi.replace('>जल्द आ रहा है</p>', '>अभी खरीदें</p>');
    expect(checkTemplatePage(reworded, templateExpect)).toEqual([
      '"coming soon" badge "जल्द आ रहा है" not found',
    ]);
  });

  it('fails on the wrong language', () => {
    expect(checkTemplatePage(templateHi, { ...templateExpect, lang: 'en' })).toEqual([
      '<html lang> is "hi", expected "en"',
    ]);
  });
});
