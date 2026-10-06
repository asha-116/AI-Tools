import { describe, expect, it } from 'vitest';
import { Budget } from '../src/budget.js';
import { BudgetExceeded, LlmUnavailable } from '../src/errors.js';
import {
  availableProviders,
  backoffMs,
  createLlm,
  loadProviders,
  type Provider,
} from '../src/llm.js';
import { completion, fakeFetch, jsonResponse, memoryLogger } from '../src/testing.js';

// Fake keys are built at runtime so secret scanners never see a key-shaped literal.
const KEY_A = 'test-key-' + 'a'.repeat(12);
const KEY_B = 'test-key-' + 'b'.repeat(12);

const P: Provider[] = [
  {
    id: 'one',
    baseUrl: 'https://one.test/v1/',
    keyEnv: 'ONE_KEY',
    model: 'm1',
    family: 'gemini',
    limits: { maxOutputTokens: 100 },
  },
  {
    id: 'two',
    baseUrl: 'https://two.test/v1',
    keyEnv: 'TWO_KEY',
    model: 'm2',
    family: 'llama',
    limits: {},
  },
  { id: 'local', baseUrlEnv: 'LOCAL_URL', model: 'm3', family: 'qwen', limits: {} },
];
const ENV = { ONE_KEY: KEY_A, TWO_KEY: KEY_B };
const noSleep = async (): Promise<void> => undefined;
const msg = [{ role: 'user' as const, content: 'hello' }];

describe('providers.json', () => {
  it('loads and validates the shipped providers in ADR-013 order', () => {
    const ids = loadProviders().map((p) => p.id);
    expect(ids).toEqual(['gemini', 'groq', 'cerebras', 'openrouter', 'ollama']);
  });
  it('every shipped provider has a family and either a key env or base-URL env', () => {
    for (const p of loadProviders()) {
      expect(p.family).toBeTruthy();
      expect(p.keyEnv ?? p.baseUrlEnv).toBeTruthy();
    }
  });
  it('rejects a paid (non-:free) OpenRouter model', () => {
    const bad = {
      providers: [
        {
          id: 'or',
          baseUrl: 'https://openrouter.ai/api/v1',
          keyEnv: 'K',
          model: 'x/y',
          family: 'x',
        },
      ],
    };
    expect(() => loadProviders(bad)).toThrow(/free/);
  });
  it('rejects a provider without any base URL', () => {
    expect(() =>
      loadProviders({ providers: [{ id: 'x', keyEnv: 'K', model: 'm', family: 'f' }] }),
    ).toThrow();
  });
});

describe('availableProviders', () => {
  it('skips providers without a key or base URL', () => {
    expect(availableProviders(P, ENV).map((p) => p.id)).toEqual(['one', 'two']);
    expect(
      availableProviders(P, { ...ENV, LOCAL_URL: 'http://localhost:11434/v1' }).map((p) => p.id),
    ).toEqual(['one', 'two', 'local']);
  });
  it('excludes families (string or list, any case)', () => {
    expect(availableProviders(P, ENV, 'GEMINI').map((p) => p.id)).toEqual(['two']);
    expect(availableProviders(P, ENV, ['gemini', 'llama'])).toEqual([]);
  });
  it('builds the chat/completions URL without double slashes', () => {
    expect(availableProviders(P, ENV)[0]?.url).toBe('https://one.test/v1/chat/completions');
  });
});

describe('backoffMs', () => {
  it('doubles per attempt with 50–100% jitter, capped', () => {
    expect(backoffMs(0, 1000, 30000, () => 0)).toBe(500);
    expect(backoffMs(0, 1000, 30000, () => 1)).toBe(1000);
    expect(backoffMs(3, 1000, 30000, () => 1)).toBe(8000);
    expect(backoffMs(10, 1000, 30000, () => 1)).toBe(30000);
  });
});

describe('createLlm().chat', () => {
  it('returns text, provider, model, family and usage; sends key, model and JSON mode', async () => {
    const f = fakeFetch(() =>
      jsonResponse(completion('{"a":1}', { prompt_tokens: 7, completion_tokens: 3 })),
    );
    const llm = createLlm({ env: ENV, providers: P, fetch: f, sleep: noSleep });
    const r = await llm.chat({ messages: msg, jsonMode: true });
    expect(r).toEqual({
      text: '{"a":1}',
      provider: 'one',
      model: 'm1',
      family: 'gemini',
      usage: { prompt: 7, completion: 3 },
    });
    const call = f.calls[0];
    expect(call?.url).toBe('https://one.test/v1/chat/completions');
    expect(call?.headers.authorization).toBe(`Bearer ${KEY_A}`);
    expect(call?.body).toMatchObject({
      model: 'm1',
      max_tokens: 100,
      response_format: { type: 'json_object' },
    });
    expect(llm.familiesUsed()).toEqual(['gemini']);
  });

  it('retries 429 and 5xx with backoff, then succeeds on the same provider', async () => {
    const statuses = [429, 503];
    const f = fakeFetch(() => {
      const s = statuses.shift();
      return s ? jsonResponse({ error: 'busy' }, s) : jsonResponse(completion('ok'));
    });
    const slept: number[] = [];
    const llm = createLlm({
      env: ENV,
      providers: P,
      fetch: f,
      sleep: async (ms) => void slept.push(ms),
      random: () => 1,
    });
    const r = await llm.chat({ messages: msg });
    expect(r.provider).toBe('one');
    expect(slept).toEqual([1000, 2000]);
  });

  it('honours Retry-After (capped by maxDelayMs)', async () => {
    let n = 0;
    const f = fakeFetch(() =>
      n++ === 0 ? jsonResponse({}, 429, { 'retry-after': '120' }) : jsonResponse(completion('ok')),
    );
    const slept: number[] = [];
    const llm = createLlm({
      env: ENV,
      providers: P,
      fetch: f,
      sleep: async (ms) => void slept.push(ms),
      maxDelayMs: 5000,
    });
    await llm.chat({ messages: msg });
    expect(slept).toEqual([5000]);
  });

  it('falls through to the next provider after retries are exhausted', async () => {
    const f = fakeFetch((req) =>
      req.url.includes('one.test') ? jsonResponse({}, 500) : jsonResponse(completion('from two')),
    );
    const log = memoryLogger('t');
    const llm = createLlm({
      env: ENV,
      providers: P,
      fetch: f,
      sleep: noSleep,
      maxRetries: 2,
      logger: log,
    });
    const r = await llm.chat({ messages: msg });
    expect(r).toMatchObject({ text: 'from two', provider: 'two', family: 'llama' });
    expect(f.calls.filter((c) => c.url.includes('one.test'))).toHaveLength(3);
    expect(log.lines.map((l) => l.event)).toEqual([
      'llm.retry',
      'llm.retry',
      'llm.retry',
      'llm.fallback',
      'llm.usage',
    ]);
  });

  it('does not retry a 401; moves straight to the next provider', async () => {
    const f = fakeFetch((req) =>
      req.url.includes('one.test') ? jsonResponse({}, 401) : jsonResponse(completion('ok')),
    );
    const llm = createLlm({ env: ENV, providers: P, fetch: f, sleep: noSleep });
    await llm.chat({ messages: msg });
    expect(f.calls.map((c) => new URL(c.url).host)).toEqual(['one.test', 'two.test']);
  });

  it('retries network errors', async () => {
    let n = 0;
    const f = fakeFetch(() => {
      if (n++ === 0) throw new TypeError('fetch failed');
      return jsonResponse(completion('ok'));
    });
    const llm = createLlm({ env: ENV, providers: P, fetch: f, sleep: noSleep });
    expect((await llm.chat({ messages: msg })).provider).toBe('one');
  });

  it('a provider that stays unreachable is reported, using the real (tiny) sleep', async () => {
    const f = fakeFetch(() => {
      throw 'socket hang up';
    });
    const llm = createLlm({
      env: { ONE_KEY: KEY_A },
      providers: P,
      fetch: f,
      maxRetries: 1,
      baseDelayMs: 1,
    });
    const err = (await llm.chat({ messages: msg }).catch((e: unknown) => e)) as LlmUnavailable;
    expect(err.attempts).toEqual([{ provider: 'one', status: 0, reason: 'network' }]);
    expect(f.calls).toHaveLength(2);
  });

  it('a 200 with a non-JSON body is a provider failure', async () => {
    const f = fakeFetch(() => new Response('<html>', { status: 200 }));
    const llm = createLlm({ env: { ONE_KEY: KEY_A }, providers: P, fetch: f });
    await expect(llm.chat({ messages: msg })).rejects.toThrow(/one=empty or malformed/);
  });

  it('treats an empty or malformed answer as a provider failure', async () => {
    const f = fakeFetch((req) =>
      req.url.includes('one.test')
        ? jsonResponse({ choices: [{ message: { content: '  ' } }] })
        : jsonResponse({ nope: 1 }),
    );
    const llm = createLlm({ env: ENV, providers: P, fetch: f, sleep: noSleep });
    const err = await llm.chat({ messages: msg }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmUnavailable);
    expect((err as LlmUnavailable).attempts.map((a) => a.provider)).toEqual(['one', 'two']);
  });

  it('throws LlmUnavailable when no provider has a key', async () => {
    const llm = createLlm({ env: {}, providers: P, fetch: fakeFetch(() => jsonResponse({})) });
    await expect(llm.chat({ messages: msg })).rejects.toThrow(/no LLM provider available/);
  });

  it('excludeFamily skips the producer family (Verifier)', async () => {
    const f = fakeFetch(() => jsonResponse(completion('ok')));
    const llm = createLlm({ env: ENV, providers: P, fetch: f });
    const r = await llm.chat({ messages: msg, excludeFamily: 'gemini' });
    expect(r.family).toBe('llama');
  });

  it('sends no Authorization header to a keyless local provider; estimates missing usage', async () => {
    const f = fakeFetch(() => jsonResponse({ choices: [{ message: { content: 'abcdefgh' } }] }));
    const llm = createLlm({
      env: { LOCAL_URL: 'http://localhost:11434/v1' },
      providers: P,
      fetch: f,
    });
    const r = await llm.chat({
      messages: [{ role: 'user', content: 'x'.repeat(40) }],
      temperature: 0,
      maxTokens: 9,
    });
    expect(f.calls[0]?.headers.authorization).toBeUndefined();
    expect(f.calls[0]?.body).toMatchObject({ temperature: 0, max_tokens: 9 });
    expect(r.usage).toEqual({ prompt: 10, completion: 2 });
  });

  it('charges the budget and refuses to call once it is spent', async () => {
    const f = fakeFetch(() =>
      jsonResponse(completion('ok', { prompt_tokens: 60, completion_tokens: 50 })),
    );
    const budget = new Budget('t', 100);
    const llm = createLlm({ env: ENV, providers: P, fetch: f, budget });
    await expect(llm.chat({ messages: msg })).rejects.toBeInstanceOf(BudgetExceeded);
    await expect(llm.chat({ messages: msg })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(f.calls).toHaveLength(1);
  });

  it('never logs prompts, replies or keys', async () => {
    const f = fakeFetch(() => jsonResponse(completion('SECRET-REPLY')));
    const log = memoryLogger('t');
    const llm = createLlm({ env: ENV, providers: P, fetch: f, logger: log });
    await llm.chat({ messages: [{ role: 'user', content: 'SECRET-PROMPT' }] });
    const text = JSON.stringify(log.lines);
    expect(text).not.toMatch(/SECRET-PROMPT|SECRET-REPLY/);
    expect(text).not.toContain(KEY_A);
  });
});
