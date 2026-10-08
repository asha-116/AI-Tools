import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Escalation, LlmUnavailable } from '../src/errors.js';
import type { LlmClient, LlmRequest } from '../src/llm.js';
import { promptSections, readAgentFile, renderTemplate } from '../src/prompt.js';
import { chatJson, parseJsonLoose, validateWithRetry } from '../src/schema.js';
import { fakeLlm, memoryLogger } from '../src/testing.js';

/** Two families: 'gemini' answers unless excluded, then 'gpt'. Replies are queued per family. */
function twoFamilies(replies: Record<'gemini' | 'gpt', string[]>): LlmClient & {
  requests: LlmRequest[];
} {
  const requests: LlmRequest[] = [];
  return {
    requests,
    familiesUsed: () => [],
    async chat(req) {
      requests.push(req);
      const ex =
        typeof req.excludeFamily === 'string' ? [req.excludeFamily] : (req.excludeFamily ?? []);
      const family = (['gemini', 'gpt'] as const).find((f) => !ex.includes(f));
      const text = family ? replies[family].shift() : undefined;
      if (!family || text === undefined) throw new LlmUnavailable([]);
      return {
        text,
        provider: family,
        model: `${family}-m`,
        family,
        usage: { prompt: 1, completion: 1 },
      };
    },
  };
}

const S = z.object({ n: z.number().int(), tag: z.enum(['a', 'b']) });

describe('parseJsonLoose', () => {
  it('parses plain JSON', () => expect(parseJsonLoose('{"n":1}')).toEqual({ n: 1 }));
  it('parses a ```json fence', () =>
    expect(parseJsonLoose('Here:\n```json\n{"n":2}\n```\nbye')).toEqual({ n: 2 }));
  it('parses an object surrounded by prose', () =>
    expect(parseJsonLoose('Sure! {"n":3} hope that helps')).toEqual({ n: 3 }));
  it('parses an array', () => expect(parseJsonLoose('result: [1,2]')).toEqual([1, 2]));
  it('throws when there is no JSON', () => expect(() => parseJsonLoose('no json here')).toThrow());
});

describe('validateWithRetry', () => {
  it('returns valid data from the first call', async () => {
    const feedback: (string | undefined)[] = [];
    const data = await validateWithRetry(async (f) => (feedback.push(f), '{"n":1,"tag":"a"}'), S);
    expect(data).toEqual({ n: 1, tag: 'a' });
    expect(feedback).toEqual([undefined]);
  });
  it('retries once with the validation error, then succeeds', async () => {
    const replies = ['{"n":1.5,"tag":"c"}', '{"n":1,"tag":"b"}'];
    const feedback: (string | undefined)[] = [];
    const data = await validateWithRetry(
      async (f) => (feedback.push(f), replies.shift() as string),
      S,
    );
    expect(data).toEqual({ n: 1, tag: 'b' });
    expect(feedback[1]).toMatch(/n/);
    expect(feedback[1]).toMatch(/tag/);
  });
  it('treats invalid JSON as a validation failure', async () => {
    const replies = ['not json', '{"n":2,"tag":"a"}'];
    const feedback: (string | undefined)[] = [];
    await validateWithRetry(async (f) => (feedback.push(f), replies.shift() as string), S);
    expect(feedback[1]).toMatch(/^Invalid JSON/);
  });
  it('throws Escalation after the second failure, with a stable key', async () => {
    const err = await validateWithRetry(async () => '{}', S, 'Orchestrator plan').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Escalation);
    expect((err as Escalation).request).toMatchObject({
      title: 'Invalid Orchestrator plan after retry',
      key: 'invalid-output-orchestrator-plan',
    });
    expect((err as Escalation).request.options.length).toBeGreaterThan(1);
  });
  it('bounds very long errors', async () => {
    const Big = z.object(
      Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`field_${i}`, z.string()])),
    );
    const err = (await validateWithRetry(async () => '{}', Big).catch(
      (e: unknown) => e,
    )) as Escalation;
    expect(err.request.context.length).toBeLessThan(1700);
  });
});

describe('chatJson', () => {
  it('uses JSON mode and shows the model its previous answer plus the error on retry', async () => {
    const llm = fakeLlm(['{"n":"x"}', { text: '{"n":4,"tag":"a"}', family: 'llama' }]);
    const { data, response } = await chatJson(
      llm,
      { messages: [{ role: 'user', content: 'go' }] },
      S,
      'thing',
    );
    expect(data).toEqual({ n: 4, tag: 'a' });
    expect(response.family).toBe('llama');
    expect(llm.requests[0]).toMatchObject({
      jsonMode: true,
      messages: [{ role: 'user', content: 'go' }],
    });
    const retry = llm.requests[1]?.messages ?? [];
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: 'assistant', content: '{"n":"x"}' });
    expect(retry[2]?.content).toMatch(/previous reply was invalid/);
  });
  it('after two invalid replies, gives a model of another family two tries before escalating', async () => {
    const llm = twoFamilies({ gemini: ['{}', '{"n":"x"}'], gpt: ['{"n":2,"tag":"b"}'] });
    const log = memoryLogger('t');
    const { data, response } = await chatJson(
      llm,
      { messages: [{ role: 'user', content: 'go' }], excludeFamily: 'llama' },
      S,
      'thing',
      { log },
    );
    expect(data).toEqual({ n: 2, tag: 'b' });
    expect(response.family).toBe('gpt');
    // The second family starts fresh (no earlier answer) and keeps the caller's exclusions.
    expect(llm.requests[2]).toMatchObject({
      excludeFamily: ['llama', 'gemini'],
      messages: [{ role: 'user', content: 'go' }],
    });
    const invalid = log.lines.filter((l) => l.event === 'llm.invalid_output');
    expect(invalid.map((l) => [l['provider'], l['attempt']])).toEqual([
      ['gemini', 0],
      ['gemini', 1],
    ]);
    expect(String(invalid[0]?.['error'])).toMatch(/n/);
  });
  it('escalates with the first error when no other family is available', async () => {
    const llm = fakeLlm(['{}', '{"n":"x"}'], { family: 'gemini' });
    const err = await chatJson(llm, { messages: [] }, S, 'thing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Escalation);
    expect(llm.requests).toHaveLength(3);
  });
  it('escalates when the second family is invalid too', async () => {
    const llm = twoFamilies({ gemini: ['{}', '{}'], gpt: ['[]', '{}'] });
    await expect(chatJson(llm, { messages: [] }, S, 'thing')).rejects.toBeInstanceOf(Escalation);
    expect(llm.requests).toHaveLength(4);
  });
  it('does not try another family for errors other than invalid output', async () => {
    const llm = fakeLlm([new Error('boom')]);
    await expect(chatJson(llm, { messages: [] }, S)).rejects.toThrow('boom');
    expect(llm.requests).toHaveLength(1);
  });
  it('respects an explicit jsonMode: false', async () => {
    const llm = fakeLlm(['{"n":1,"tag":"a"}']);
    await chatJson(llm, { messages: [], jsonMode: false }, S);
    expect(llm.requests[0]?.jsonMode).toBe(false);
  });
});

describe('prompt helpers', () => {
  it('renderTemplate fills slots and rejects missing or unused values', () => {
    expect(renderTemplate('Hi {{ name }}, {{n}} tools', { name: 'Asha', n: 3 })).toBe(
      'Hi Asha, 3 tools',
    );
    expect(() => renderTemplate('Hi {{name}}', {})).toThrow(/no value/);
    expect(() => renderTemplate('Hi', { name: 'x' })).toThrow(/not used: name/);
  });
  it('promptSections splits on ## headings', () => {
    const md = '# Title\nnotes\n## System\nYou are careful.\n\n## user\nDo {{x}}.\n';
    expect(promptSections(md)).toEqual({ system: 'You are careful.', user: 'Do {{x}}.' });
  });
  it('readAgentFile reads agents/<name>/<file> and refuses traversal', () => {
    const root = mkdtempSync(join(tmpdir(), 'repo-'));
    mkdirSync(join(root, 'agents', 'qa'), { recursive: true });
    writeFileSync(join(root, 'agents', 'qa', 'prompt.md'), 'hello');
    expect(readAgentFile(root, 'qa', 'prompt.md')).toBe('hello');
    expect(() => readAgentFile(root, 'qa', '../../etc/passwd')).toThrow(/invalid/);
    expect(() => readAgentFile(root, '../x', 'prompt.md')).toThrow(/invalid/);
  });
});
