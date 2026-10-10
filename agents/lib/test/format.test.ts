import { describe, expect, it } from 'vitest';
import { formatFiles, prettierFormatter } from '../src/format.js';

describe('formatFiles', () => {
  it('formats markdown the way `prettier --check` expects (tables aligned)', async () => {
    const md = '# T\n\n| A | B |\n| --- | ---: |\n| long label | ₹1 |\n';
    const [out] = await formatFiles([{ path: 'site/src/content/articles/x.en.md', content: md }]);
    expect(out?.content).toContain('| A          |   B |');
    // Already formatted → unchanged.
    expect(await prettierFormatter('x.md', out?.content ?? '')).toBe(out?.content);
  });

  it('formats JSON and leaves deletions, unknown types and unparsable files alone', async () => {
    const files = await formatFiles([
      { path: 'a.json', content: '{"a":1}' },
      { path: 'gone.md', content: null },
      { path: 'notes.unknownext', content: 'x  y' },
      { path: 'bad.json', content: '{oops' },
    ]);
    expect(files.map((f) => f.content)).toEqual(['{ "a": 1 }\n', null, 'x  y', '{oops']);
  });

  it('uses an injected formatter', async () => {
    const files = await formatFiles([{ path: 'a', content: 'x' }], async (_p, c) => c + '!');
    expect(files[0]?.content).toBe('x!');
  });
});
