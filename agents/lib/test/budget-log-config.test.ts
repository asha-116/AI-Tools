import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Budget, tokensUsedInLog } from '../src/budget.js';
import { isDryRun, loadConfig, parseRepository, secretValues } from '../src/config.js';
import { BudgetExceeded } from '../src/errors.js';
import { createLogger, defaultLogDir, logPath, scrub, scrubString } from '../src/log.js';

describe('Budget', () => {
  it('tracks usage and remaining tokens', () => {
    const b = new Budget('a', 100);
    b.charge({ prompt: 30, completion: 20 });
    expect(b.used).toBe(50);
    expect(b.remaining).toBe(50);
    expect(b.daily).toBe(100);
  });
  it('throws BudgetExceeded (run) once the per-run limit is passed', () => {
    const b = new Budget('a', 100);
    b.charge({ prompt: 100, completion: 0 }); // exactly at the limit is allowed …
    expect(() => b.assertAvailable()).toThrow(BudgetExceeded); // … but nothing more
    expect(() => b.charge({ prompt: 1, completion: 0 })).toThrow(
      /run token budget exceeded \(101 \/ 100\)/,
    );
  });
  it('applies the daily cap including earlier runs', () => {
    const b = new Budget('a', { perRun: 100, daily: 120 }, 50);
    expect(b.remaining).toBe(70);
    const err = (() => {
      try {
        b.charge({ prompt: 80, completion: 0 });
      } catch (e) {
        return e as BudgetExceeded;
      }
    })();
    expect(err).toMatchObject({ scope: 'daily', limit: 120, used: 130 });
    expect(b.remaining).toBe(0);
  });
  it('a zero budget allows no LLM call at all (QA default)', () => {
    expect(() => new Budget('qa', 0).assertAvailable()).toThrow(BudgetExceeded);
  });
  it('rejects a negative budget and ignores negative usage', () => {
    expect(() => new Budget('a', -1)).toThrow(RangeError);
    const b = new Budget('a', 10);
    b.charge({ prompt: -5, completion: 2 });
    expect(b.used).toBe(2);
  });
  it('tokensUsedInLog sums run.end tokens and ignores torn lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-'));
    const p = join(dir, 'x.jsonl');
    expect(tokensUsedInLog(p)).toBe(0);
    writeFileSync(
      p,
      [
        JSON.stringify({ event: 'run.end', tokens: 100 }),
        JSON.stringify({ event: 'llm.usage', tokens: 999 }),
        '{"event":"run.e',
        '',
        JSON.stringify({ event: 'run.end', tokens: 25 }),
      ].join('\n'),
    );
    expect(tokensUsedInLog(p)).toBe(125);
  });
});

describe('config', () => {
  it('dry-run unless DRY_RUN is exactly "false"', () => {
    expect(isDryRun({})).toBe(true);
    expect(isDryRun({ DRY_RUN: 'true' })).toBe(true);
    expect(isDryRun({ DRY_RUN: 'FALSE' })).toBe(true);
    expect(isDryRun({ DRY_RUN: '0' })).toBe(true);
    expect(isDryRun({ DRY_RUN: 'false' })).toBe(false);
  });
  it('parses GITHUB_REPOSITORY', () => {
    expect(parseRepository('asha-116/AI-Tools')).toEqual({ owner: 'asha-116', repo: 'AI-Tools' });
    expect(parseRepository('nope')).toBeUndefined();
    expect(parseRepository(undefined)).toBeUndefined();
  });
  it('loadConfig reads token, repo and repo root', () => {
    const c = loadConfig(
      {
        GITHUB_TOKEN: 't'.repeat(10),
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_WORKSPACE: '/ws',
        DRY_RUN: 'false',
      },
      '/cwd',
    );
    expect(c).toMatchObject({
      dryRun: false,
      githubToken: 't'.repeat(10),
      repository: { owner: 'o', repo: 'r' },
      repoRoot: '/ws',
    });
    expect(loadConfig({ GITHUB_TOKEN: '' }, '/cwd')).toMatchObject({
      githubToken: undefined,
      repoRoot: '/cwd',
      dryRun: true,
    });
  });
  it('secretValues picks long values of secret-looking names', () => {
    expect(
      secretValues({
        GEMINI_API_KEY: 'x'.repeat(20),
        GITHUB_TOKEN: 'short',
        DRY_RUN: 'false',
        MY_SECRET: 'y'.repeat(9),
        PATH: '/usr/bin:/bin',
      }),
    ).toEqual(['x'.repeat(20), 'y'.repeat(9)]);
  });
});

describe('log scrubbing', () => {
  // Key-shaped strings are assembled at runtime so secret scanners don't flag this file.
  const keys = [
    'sk-' + 'A'.repeat(24),
    'sk-or-v1-' + 'b'.repeat(30),
    'gsk_' + 'C'.repeat(30),
    'csk-' + 'd'.repeat(30),
    'AIza' + 'E'.repeat(35),
    'ghp_' + 'F'.repeat(36),
    'github_pat_' + 'G'.repeat(40),
    'rzp_test_' + 'H'.repeat(14),
  ];
  it.each(keys)('removes key pattern %#', (k) => {
    expect(scrubString(`key=${k} end`)).toBe('key=[SECRET] end');
  });
  it('removes Bearer tokens and known env values', () => {
    expect(scrubString('Authorization: Bearer abc.def-ghi_123')).toBe('Authorization: [SECRET]');
    expect(scrubString('value hunter2hunter2 here', ['hunter2hunter2'])).toBe(
      'value [SECRET] here',
    );
  });
  it('redacts PII in strings', () => {
    expect(scrubString('from a@b.com')).toBe('from [EMAIL_1]');
  });
  it('deep-scrubs objects, arrays and errors; omits forbidden fields', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };
    expect(
      scrub({
        n: 1,
        ok: true,
        nil: null,
        list: ['x@y.com'],
        prompt: 'never',
        Authorization: 'never',
        err: new Error('call 9876543210'),
        deep,
      }),
    ).toEqual({
      n: 1,
      ok: true,
      nil: null,
      list: ['[EMAIL_1]'],
      prompt: '[OMITTED]',
      Authorization: '[OMITTED]',
      err: { name: 'Error', message: 'call [PHONE_1]' },
      deep: { a: { b: { c: { d: { e: { f: '[DEPTH]' } } } } } },
    });
  });
});

describe('createLogger', () => {
  it('writes JSON lines to <dir>/<agent>/<UTC date>.jsonl with scrubbing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'log-'));
    const echoed: string[] = [];
    const log = createLogger({
      agent: 'support',
      dir,
      now: () => new Date('2026-10-06T23:59:00Z'),
      runId: '42',
      secrets: ['supersecretvalue'],
      echo: (l) => echoed.push(l),
    });
    expect(log.path).toBe(join(dir, 'support', '2026-10-06.jsonl'));
    log.info('reply', { to: 'x@y.com', note: 'token supersecretvalue' });
    log.warn('w');
    log.error('e');
    log.debug('d');
    const lines = readFileSync(log.path, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toEqual({
      ts: '2026-10-06T23:59:00.000Z',
      agent: 'support',
      run_id: '42',
      level: 'info',
      event: 'reply',
      to: '[EMAIL_1]',
      note: 'token [SECRET]',
    });
    expect(lines.map((l) => l.level)).toEqual(['info', 'warn', 'error', 'debug']);
    expect(echoed).toHaveLength(4);
  });
  it('defaults: repo-relative log dir and stdout echo', () => {
    expect(defaultLogDir('/repo')).toBe(join('/repo', 'company', 'reports', 'agent-logs'));
    expect(logPath('/d', 'qa', new Date('2026-01-02T03:04:05Z'))).toBe(
      join('/d', 'qa', '2026-01-02.jsonl'),
    );
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    const echoed: string[] = [];
    process.stdout.write = ((s: string) => (echoed.push(s), true)) as typeof process.stdout.write;
    try {
      const log = createLogger({
        agent: 'qa',
        repoRoot: '/repo',
        write: (_p, l) => written.push(l),
      });
      log.info('x');
      expect(log.path.startsWith(join('/repo', 'company', 'reports', 'agent-logs', 'qa'))).toBe(
        true,
      );
    } finally {
      process.stdout.write = original;
    }
    expect(written).toHaveLength(1);
    expect(echoed).toEqual(written);
  });
});
