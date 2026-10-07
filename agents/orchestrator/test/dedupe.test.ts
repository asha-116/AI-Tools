import { describe, expect, it } from 'vitest';
import { dedupe, findDuplicate, normaliseTitle, titleSimilarity } from '../src/dedupe.js';

describe('normaliseTitle', () => {
  it('drops prefixes, punctuation, stopwords and plural s', () => {
    expect(normaliseTitle('feat(site): Add the EMI calculator pages!')).toEqual([
      'add',
      'emi',
      'calculator',
      'page',
    ]);
    expect(normaliseTitle('[agent] fix: Fix   class bus')).toEqual(['fix', 'class', 'bus']);
  });
  it('keeps Hindi words', () => {
    expect(normaliseTitle('स्टाम्प ड्यूटी कैलकुलेटर')).toEqual(['स्टाम्प', 'ड्यूटी', 'कैलकुलेटर']);
  });
});

describe('titleSimilarity', () => {
  it('is the Jaccard index of word sets', () => {
    expect(titleSimilarity('Add EMI calculator', 'feat: add the EMI calculators')).toBe(1);
    expect(titleSimilarity('Add EMI calculator', 'Add stamp duty calculator')).toBeCloseTo(2 / 5);
    expect(titleSimilarity('the', 'the')).toBe(0);
  });
});

describe('findDuplicate / dedupe', () => {
  const open = [
    { title: 'Build stamp duty calculator for Karnataka', labels: ['agent:builder', 'type:tool'] },
    { title: 'Write FAQ for commission ledger', labels: ['agent:seo-listing'] },
  ];

  it('treats near-identical titles as duplicates regardless of labels', () => {
    expect(
      findDuplicate({ title: 'Build Karnataka stamp duty calculator', labels: [] }, open),
    ).toBe(open[0]);
  });

  it('needs a shared agent/type label when titles are only similar', () => {
    const c = { title: 'Write FAQ page for the lead tracker', labels: ['agent:seo-listing'] };
    // {write, faq, page, lead, tracker} vs {write, faq, commission, ledger}: 2/7 → not similar
    expect(findDuplicate(c, open)).toBeUndefined();
    const similar = {
      title: 'Write commission ledger FAQ page and video',
      labels: ['agent:seo-listing'],
    };
    expect(findDuplicate(similar, open)).toBe(open[1]);
    expect(findDuplicate({ ...similar, labels: ['agent:social'] }, open)).toBeUndefined();
    expect(findDuplicate({ ...similar, labels: ['priority:high'] }, open)).toBeUndefined();
  });

  it('drops duplicates of open Issues and of earlier candidates', () => {
    const r = dedupe(
      [
        { title: 'Build Karnataka stamp duty calculator', labels: [] },
        { title: 'Add Hindi glossary page', labels: ['type:content'] },
        { title: 'Add Hindi glossary pages', labels: [] },
        { title: 'Something new', labels: [] },
      ],
      open,
    );
    expect(r.kept.map((k) => k.title)).toEqual(['Add Hindi glossary page', 'Something new']);
    expect(r.dropped.map((d) => [d.candidate.title, d.duplicateOf.title])).toEqual([
      ['Build Karnataka stamp duty calculator', open[0]?.title],
      ['Add Hindi glossary pages', 'Add Hindi glossary page'],
    ]);
  });
});
