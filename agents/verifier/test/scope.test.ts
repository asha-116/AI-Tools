import { describe, expect, it } from 'vitest';
import { addedLines, classify, isTextFile, priceChanged, producerFamily } from '../src/scope.js';

const f = (filename: string, patch?: string, status = 'modified') => ({
  filename,
  status,
  ...(patch === undefined ? {} : { patch }),
});

describe('classify', () => {
  it('is not applicable when nothing in scope changes', () => {
    const s = classify([f('site/src/pages/index.astro'), f('README.md'), f('agents/qa/src/x.ts')]);
    expect(s.applicable).toBe(false);
    expect(s.inScope).toEqual([]);
  });

  it('puts each in-scope path in the right bucket', () => {
    const s = classify([
      f('tools-core/src/emi.ts'),
      f('tools-core/test/fixtures/emi-known-answers.json'),
      f('tools-core/test/emi.test.ts'),
      f('data/stamp-duty/mh.json', '+  "rate": 6'),
      f('data/stamp-duty/README.md', '+CI fails stale files'),
      f('site/src/content/en/guide.md', '+Hello'),
      f('company/policies/refund-policy.md', '+x'),
      f('legal/terms.md', '+y'),
      f('products/lead-tracker/spec.json', '+z'),
      f('products/lead-tracker/en.xlsx'),
      f('legal/old.md', undefined, 'removed'),
    ]);
    expect(s.applicable).toBe(true);
    expect(s.formulaFiles).toEqual([
      'tools-core/src/emi.ts',
      'tools-core/test/fixtures/emi-known-answers.json',
    ]);
    expect(s.textFiles.map((t) => t.filename)).toEqual([
      'data/stamp-duty/mh.json',
      'site/src/content/en/guide.md',
      'company/policies/refund-policy.md',
      'legal/terms.md',
      'products/lead-tracker/spec.json',
    ]);
    expect(s.contentFiles).toEqual(['site/src/content/en/guide.md']);
    expect(s.approvalReasons).toEqual([
      'touches legal/policy text: company/policies/refund-policy.md, legal/terms.md, legal/old.md',
    ]);
  });

  it('a renamed-away legal file still needs approval', () => {
    const s = classify([
      { filename: 'docs/x.md', status: 'renamed', previous_filename: 'legal/x.md' },
    ]);
    expect(s.applicable).toBe(true);
    expect(s.approvalReasons[0]).toContain('legal/x.md');
  });

  it('a price change anywhere needs approval', () => {
    const s = classify([
      f('products/catalog.json', '@@ -1 +1 @@\n-      "price_inr": 199,\n+      "price_inr": 249,'),
    ]);
    expect(s.approvalReasons).toEqual(['changes a price: products/catalog.json']);
  });
});

describe('priceChanged', () => {
  it('sees added or removed price keys only', () => {
    expect(priceChanged(f('a.json', '+  "price_inr": 1'))).toBe(true);
    expect(priceChanged(f('a.json', '-  "price": 1'))).toBe(true);
    expect(priceChanged(f('a.json', '   "price_inr": 1\n+ "name": "x"'))).toBe(false);
    expect(priceChanged(f('a.json', '+++ b/price_inr: 1'))).toBe(false);
    expect(priceChanged(f('a.json'))).toBe(false);
  });
});

describe('addedLines', () => {
  it('keeps added lines without the + and skips the file header', () => {
    expect(addedLines('@@ -1,2 +1,2 @@\n+++ b/x\n-old\n+new\n context\n+two')).toBe('new\ntwo');
    expect(addedLines(undefined)).toBe('');
  });
});

describe('isTextFile', () => {
  it('accepts text formats and rejects binaries', () => {
    for (const n of [
      'a.md',
      'a.mdx',
      'a.json',
      'a.yml',
      'a.yaml',
      'a.txt',
      'a.csv',
      'a.astro',
      'a.html',
    ]) {
      expect(isTextFile(n)).toBe(true);
    }
    for (const n of ['a.xlsx', 'a.png', 'a.pdf', 'README']) expect(isTextFile(n)).toBe(false);
  });
});

describe('producerFamily', () => {
  it('reads the PR body marker, lower-cased', () => {
    expect(producerFamily('x\n<!-- producer-family: Gemini -->\n')).toBe('gemini');
    expect(producerFamily('<!--producer-family:llama-->')).toBe('llama');
  });
  it('is undefined without a marker or with "unknown"', () => {
    expect(producerFamily('no marker')).toBeUndefined();
    expect(producerFamily('<!-- producer-family: unknown -->')).toBeUndefined();
    expect(producerFamily('')).toBeUndefined();
  });
});
