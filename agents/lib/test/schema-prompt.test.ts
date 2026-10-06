import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Escalation } from '../src/errors.js';
import { promptSections, readAgentFile, renderTemplate } from '../src/prompt.js';
import { chatJson, parseJsonLoose, validateWithRetry } from '../src/schema.js';
import { fakeLlm } from '../src/testing.js';

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
