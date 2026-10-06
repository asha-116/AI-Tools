import { describe, expect, it } from 'vitest';
import type { VerifierReport } from '../schema.js';
import { cell, clip, renderComment, statusFor } from '../src/report.js';

const base: VerifierReport = {
  pr: 3,
  verifier_model_family: 'llama',
  producer_model_family: 'gemini',
  cases: [],
  claims: [],
  verdict: 'pass',
  reasons: [],
};

describe('report', () => {
  it('clip and cell keep table cells short and pipe-safe', () => {
    expect(clip('abc', 3)).toBe('abc');
    expect(clip('abcd', 3)).toBe('ab…');
    expect(cell('a|b\nc')).toBe('a\\|b c');
    expect(cell({ x: 1 })).toBe('{"x":1}');
    expect(cell(undefined)).toBe('');
  });

  it('maps verdicts to commit states', () => {
    expect(statusFor(base, 'ok').state).toBe('success');
    expect(statusFor({ ...base, verdict: 'fail' }, 'x').state).toBe('failure');
    expect(statusFor({ ...base, verdict: 'pending' }, 'x').state).toBe('pending');
    expect(statusFor(base, 'x', 'error')).toEqual({
      context: 'verifier',
      state: 'error',
      description: 'x',
    });
    expect(statusFor(base, 'y'.repeat(200)).description).toHaveLength(140);
  });

  it('renders cases, claims, reasons, notes and the JSON report', () => {
    const md = renderComment(
      {
        ...base,
        verdict: 'fail',
        reasons: ['r1'],
        cases: [
          {
            formula: 'computeEmi',
            input: { p: 1 },
            field: 'emi',
            expected_by_verifier: 1.234,
            actual: 2,
            match: false,
            note: 'n',
          },
          {
            formula: 'computeEmi',
            input: { p: 1 },
            field: 'emi',
            expected_by_verifier: null,
            actual: null,
            match: true,
            note: '',
          },
        ],
        claims: [
          { file: 'a.md', claim: 'c', source: '', supported: false, status: 'unsourced', note: '' },
          {
            file: 'a.md',
            claim: 'd',
            source: 'https://x.in',
            supported: true,
            status: 'supported',
            note: '',
          },
        ],
      },
      'headline',
      ['note1'],
    );
    expect(md).toContain('## Verifier — FAIL');
    expect(md).toContain('| computeEmi | {"p":1} | emi | 1.23 | 2 | **no** | n |');
    expect(md).toContain('| — | — | yes |');
    expect(md).toContain('| a.md | c | — | **unsourced** |  |');
    expect(md).toContain('| supported |');
    expect(md).toContain('- note1');
    expect(md).toContain('"pr": 3');
    expect(renderComment({ ...base, verdict: 'pending' }, 'h')).toContain('PENDING');
    expect(renderComment(base, 'h')).toContain('PASS');
  });

  it('truncates very long comments under the GitHub limit', () => {
    const md = renderComment({ ...base, reasons: ['x'.repeat(70_000)] }, 'h');
    expect(md.length).toBeLessThan(61_000);
    expect(md).toContain('(truncated)');
  });
});
