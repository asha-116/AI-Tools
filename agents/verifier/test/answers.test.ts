import { describe, expect, it } from 'vitest';
import { formulaAnswersFor } from '../schema.js';

const schema = formulaAnswersFor([{ id: 'emi-1', fields: ['emi', 'total'] }]);

describe('formula answers', () => {
  it('evaluates expression answers exactly and keeps plain numbers', () => {
    const r = '(10.5/12/100)';
    const parsed = schema.parse({
      results: [
        {
          id: 'emi-1',
          values: { emi: `10000000 * ${r} * (1 + ${r})^120 / ((1 + ${r})^120 - 1)`, total: 5 },
        },
      ],
    });
    expect(Math.round(parsed.results[0]?.values['emi'] as number)).toBe(134935);
    expect(parsed.results[0]?.values['total']).toBe(5);
  });
  it('rejects an expression it cannot evaluate, with a message the model can act on', () => {
    const r = schema.safeParse({ results: [{ id: 'emi-1', values: { emi: 'P * r', total: 1 } }] });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join('\n')).toMatch(/cannot evaluate "P \* r"/);
  });
  it('still reports a missing field', () => {
    const r = schema.safeParse({ results: [{ id: 'emi-1', values: { emi: '1' } }] });
    expect(r.error?.issues.map((i) => i.message).join('\n')).toMatch(/missing field "total"/);
  });
  it('rejects a non-finite number', () => {
    const r = schema.safeParse({
      results: [{ id: 'emi-1', values: { emi: Number.POSITIVE_INFINITY, total: 1 } }],
    });
    expect(r.success).toBe(false);
  });
});
