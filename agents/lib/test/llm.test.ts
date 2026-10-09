import { describe, expect, it } from 'vitest';
import { Budget } from '../src/budget.js';
import { BudgetExceeded, LlmUnavailable } from '../src/errors.js';
import {
  availableProviders,
  backoffMs,
  chooseModel,
  createLlm,
  familyOf,
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
  it('keeps a provider that also serves a model outside the excluded family', () => {
    const groq: Provider = {
      id: 'g',
      baseUrl: 'https://g.test/v1',
      keyEnv: 'TWO_KEY',
      model: 'openai/gpt-oss-120b',
      family: 'gpt',
      limits: {},
    };
    expect(availableProviders([groq], ENV, 'gpt')).toEqual([]);
    const both = { ...groq, models: ['llama-3.3-70b-versatile'] };
    expect(availableProviders([both], ENV, 'gpt').map((p) => p.id)).toEqual(['g']);
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
      'llm.provider_down',
      'llm.usage',
    ]);
  });

  it('never retries a timeout; falls through to the next provider at once', async () => {
    const f = fakeFetch((req) => {
      if (req.url.includes('one.test')) throw new DOMException('timed out', 'TimeoutError');
      return jsonResponse(completion('from two'));
    });
    const log = memoryLogger('t');
    const llm = createLlm({ env: ENV, providers: P, fetch: f, sleep: noSleep, logger: log });
    const r = await llm.chat({ messages: msg });
    expect(r.provider).toBe('two');
    expect(f.calls.filter((c) => c.url.includes('one.test'))).toHaveLength(1);
    expect(log.lines.map((l) => l.event)).toContain('llm.timeout');
  });

  it('skips a provider for the rest of the run once it is down (circuit breaker)', async () => {
    const f = fakeFetch((req) =>
      req.url.includes('one.test') ? jsonResponse({}, 503) : jsonResponse(completion('ok')),
    );
    const llm = createLlm({ env: ENV, providers: P, fetch: f, sleep: noSleep, maxRetries: 1 });
    await llm.chat({ messages: msg });
    await llm.chat({ messages: msg });
    await llm.chat({ messages: msg });
    const hosts = f.calls.map((c) => new URL(c.url).host);
    expect(hosts.filter((h) => h === 'one.test')).toHaveLength(2); // first call's 2 tries only
    expect(hosts.filter((h) => h === 'two.test')).toHaveLength(3);
  });

  it('keeps a provider after a 400 or malformed answer (may be request-specific)', async () => {
    let n = 0;
    const f = fakeFetch((req) => {
      if (req.url.includes('one.test'))
        return n++ === 0 ? jsonResponse({}, 400) : jsonResponse(completion('back'));
      return jsonResponse(completion('two'));
    });
    const llm = createLlm({ env: ENV, providers: P, fetch: f, sleep: noSleep });
    expect((await llm.chat({ messages: msg })).provider).toBe('two');
    expect((await llm.chat({ messages: msg })).provider).toBe('one');
  });

  it('logs only the error code of a 400, and retries a failed JSON check once', async () => {
    const bad = () =>
      jsonResponse(
        {
          error: {
            message: 'prompt text: hello',
            type: 'invalid_request_error',
            code: 'json_validate_failed',
          },
        },
        400,
      );
    const f = fakeFetch((req) =>
      req.url.includes('one.test') ? bad() : jsonResponse(completion('two')),
    );
    const log = memoryLogger('t');
    const llm = createLlm({ env: ENV, providers: P, fetch: f, sleep: noSleep, logger: log });
    expect((await llm.chat({ messages: msg })).provider).toBe('two');
    expect(f.calls.filter((c) => c.url.includes('one.test'))).toHaveLength(2);
    const first = log.lines.find((l) => l.event === 'llm.retry');
    expect(first).toMatchObject({ provider: 'one', status: 400, code: 'json_validate_failed' });
    expect(JSON.stringify(log.lines)).not.toContain('prompt text');
    const fallback = log.lines.find((l) => l.event === 'llm.fallback');
    expect(fallback?.['reason']).toBe('HTTP 400 json_validate_failed');
  });

  it('ignores error codes that are not short identifiers, and non-JSON error bodies', async () => {
    const f = fakeFetch((req) =>
      req.url.includes('one.test')
        ? jsonResponse({ error: { code: 'has spaces and a prompt' } }, 400)
        : new Response('<html>', { status: 422 }),
    );
    const llm = createLlm({ env: ENV, providers: P, fetch: f, sleep: noSleep });
    const err = (await llm.chat({ messages: msg }).catch((e: unknown) => e)) as LlmUnavailable;
    expect(err.attempts.map((a) => a.reason)).toEqual(['HTTP 400', 'HTTP 422']);
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

  it("answers with the same provider's other-family model when the producer family is excluded", async () => {
    const groq: Provider = {
      id: 'groq',
      baseUrl: 'https://groq.test/v1',
      keyEnv: 'TWO_KEY',
      model: 'openai/gpt-oss-120b',
      models: ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
      family: 'gpt',
      limits: {},
    };
    const asked: string[] = [];
    const f = fakeFetch((req) => {
      asked.push((req.body as { model: string }).model);
      return jsonResponse(completion('ok'));
    });
    const llm = createLlm({ env: ENV, providers: [groq], fetch: f });
    const v = await llm.chat({ messages: msg, excludeFamily: 'gpt' });
    expect(v).toMatchObject({ model: 'llama-3.3-70b-versatile', family: 'llama' });
    // A request without the exclusion still uses the usual model.
    expect(await llm.chat({ messages: msg })).toMatchObject({ family: 'gpt' });
    expect(asked).toEqual(['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']);
  });

  it('when the other-family model is retired, discovery picks one outside the producer family', async () => {
    const groq: Provider = {
      id: 'groq',
      baseUrl: 'https://groq.test/v1',
      keyEnv: 'TWO_KEY',
      model: 'openai/gpt-oss-120b',
      models: ['llama-3.3-70b-versatile'],
      modelPattern: '^(openai/gpt-oss|(meta-llama/)?llama|qwen)',
      family: 'gpt',
      limits: {},
    };
    const asked: string[] = [];
    const f = fakeFetch((req) => {
      if (req.url.endsWith('/models'))
        return jsonResponse({
          data: [{ id: 'openai/gpt-oss-120b' }, { id: 'meta-llama/llama-4-scout-17b' }],
        });
      const model = (req.body as { model: string }).model;
      asked.push(model);
      return model === 'llama-3.3-70b-versatile'
        ? jsonResponse({ error: { code: 'model_not_found' } }, 404)
        : jsonResponse(completion('ok'));
    });
    const llm = createLlm({ env: ENV, providers: [groq], fetch: f, sleep: noSleep });
    const v = await llm.chat({ messages: msg, excludeFamily: 'gpt' });
    expect(v).toMatchObject({ model: 'meta-llama/llama-4-scout-17b', family: 'llama' });
    // The choice is remembered for the next Verifier request, and the usual model is untouched.
    await llm.chat({ messages: msg, excludeFamily: 'gpt' });
    expect(await llm.chat({ messages: msg })).toMatchObject({ family: 'gpt' });
    expect(asked).toEqual([
      'llama-3.3-70b-versatile',
      'meta-llama/llama-4-scout-17b',
      'meta-llama/llama-4-scout-17b',
      'openai/gpt-oss-120b',
    ]);
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

describe('familyOf / chooseModel', () => {
  it('infers the family from the model id, falling back to the provider family', () => {
    expect(familyOf('gemini-3.5-flash', 'x')).toBe('gemini');
    expect(familyOf('models/gemma-3-27b-it', 'x')).toBe('gemini');
    expect(familyOf('openai/gpt-oss-120b', 'llama')).toBe('gpt');
    expect(familyOf('llama-3.3-70b-versatile', 'x')).toBe('llama');
    expect(familyOf('qwen-3-32b', 'x')).toBe('qwen');
    expect(familyOf('deepseek/deepseek-chat:free', 'x')).toBe('deepseek');
    expect(familyOf('mixtral-8x7b', 'x')).toBe('mistral');
    expect(familyOf('moonshotai/kimi-k2', 'x')).toBe('kimi');
    expect(familyOf('something-new', 'fallback')).toBe('fallback');
  });

  const prov: Provider = {
    id: 'g',
    baseUrl: 'https://g.test/v1',
    keyEnv: 'K',
    model: 'gemini-2.5-flash',
    models: ['gemini-3.5-flash', 'gemini-3.5-flash-lite'],
    modelPattern: '^gemini-[0-9.]+-flash',
    family: 'gemini',
    limits: {},
  };

  it('prefers the configured model, then the list in order (models/ prefix ignored)', () => {
    expect(chooseModel(prov, ['models/gemini-2.5-flash', 'gemini-3.5-flash'])).toBe(
      'gemini-2.5-flash',
    );
    expect(chooseModel(prov, ['models/gemini-3.5-flash-lite', 'models/gemini-3.5-flash'])).toBe(
      'gemini-3.5-flash',
    );
  });

  it('falls back to the pattern but never picks previews or non-chat models', () => {
    expect(
      chooseModel(prov, [
        'gemini-3.9-flash-preview-0101',
        'gemini-3.8-flash-image',
        'text-embedding-004',
        'gemini-3.8-flash',
      ]),
    ).toBe('gemini-3.8-flash');
    expect(chooseModel(prov, ['gemini-3.9-flash-exp'])).toBeUndefined();
    expect(chooseModel({ ...prov, modelPattern: undefined }, ['other'])).toBeUndefined();
  });
});

describe('model discovery after a 404', () => {
  const G: Provider = {
    id: 'g',
    baseUrl: 'https://g.test/v1',
    keyEnv: 'ONE_KEY',
    model: 'old-model',
    models: ['gemini-3.5-flash'],
    family: 'gemini',
    limits: {},
  };
  const Q: Provider = {
    id: 'q',
    baseUrl: 'https://q.test/v1',
    keyEnv: 'TWO_KEY',
    model: 'llama-3.3-70b-versatile',
    modelPattern: '^openai/gpt-oss',
    family: 'llama',
    limits: {},
  };

  it('looks up /models once, switches model, logs the switch and reports the real family', async () => {
    const f = fakeFetch((req) => {
      if (req.url.endsWith('/models')) {
        expect(req.headers['authorization']).toBe(`Bearer ${KEY_A}`);
        return jsonResponse({ data: [{ id: 'models/gemini-3.5-flash' }] });
      }
      const model = (req.body as { model: string }).model;
      return model === 'gemini-3.5-flash'
        ? jsonResponse(completion('hi'))
        : jsonResponse({ error: 'not found' }, 404);
    });
    const logger = memoryLogger();
    const llm = createLlm({ env: ENV, providers: [G], fetch: f, sleep: noSleep, logger });
    const r1 = await llm.chat({ messages: msg });
    expect(r1).toMatchObject({ model: 'gemini-3.5-flash', family: 'gemini', provider: 'g' });
    const r2 = await llm.chat({ messages: msg });
    expect(r2.model).toBe('gemini-3.5-flash');
    // 404 + /models + retry, then a direct call: discovery happened once.
    expect(f.calls.map((c) => c.url.split('/').pop())).toEqual([
      'completions',
      'models',
      'completions',
      'completions',
    ]);
    expect(logger.lines.find((l) => l['event'] === 'llm.model_switched')).toMatchObject({
      provider: 'g',
      from: 'old-model',
      to: 'gemini-3.5-flash',
    });
  });

  it('when nothing fits, logs a sample of listed ids, skips the provider for the run and falls back', async () => {
    const f = fakeFetch((req) => {
      if (req.url.startsWith('https://g.test') && req.url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'unrelated-1' }, { id: 'unrelated-2' }] });
      }
      if (req.url.startsWith('https://g.test')) return jsonResponse({}, 404);
      return jsonResponse(completion('from q'));
    });
    const logger = memoryLogger();
    const llm = createLlm({ env: ENV, providers: [G, Q], fetch: f, sleep: noSleep, logger });
    expect((await llm.chat({ messages: msg })).provider).toBe('q');
    expect(logger.lines.find((l) => l['event'] === 'llm.model_unavailable')).toMatchObject({
      provider: 'g',
      listed_count: 2,
      sample: ['unrelated-1', 'unrelated-2'],
    });
    await llm.chat({ messages: msg });
    expect(f.calls.filter((c) => c.url.startsWith('https://g.test'))).toHaveLength(2);
  });

  it('treats an unreadable /models list as "nothing fits"', async () => {
    const f = fakeFetch((req) =>
      req.url.endsWith('/models') ? jsonResponse({ nope: true }, 500) : jsonResponse({}, 404),
    );
    const llm = createLlm({ env: ENV, providers: [G], fetch: f, sleep: noSleep });
    await expect(llm.chat({ messages: msg })).rejects.toBeInstanceOf(LlmUnavailable);
    const g = fakeFetch((req) => {
      if (req.url.endsWith('/models')) throw new Error('network');
      return jsonResponse({}, 404);
    });
    const llm2 = createLlm({ env: ENV, providers: [G], fetch: g, sleep: noSleep });
    await expect(llm2.chat({ messages: msg })).rejects.toBeInstanceOf(LlmUnavailable);
  });

  it('never lets a discovered model of an excluded family answer (Verifier independence)', async () => {
    const f = fakeFetch((req) => {
      if (req.url.endsWith('/models'))
        return jsonResponse({ data: [{ id: 'openai/gpt-oss-120b' }] });
      const model = (req.body as { model: string }).model;
      return model === 'openai/gpt-oss-120b'
        ? jsonResponse(completion('x'))
        : jsonResponse({}, 404);
    });
    const llm = createLlm({ env: ENV, providers: [Q], fetch: f, sleep: noSleep });
    await expect(llm.chat({ messages: msg, excludeFamily: 'gpt' })).rejects.toBeInstanceOf(
      LlmUnavailable,
    );
    // Without the exclusion the same switch is fine, and the family is the real one.
    const llm2 = createLlm({ env: ENV, providers: [Q], fetch: f, sleep: noSleep });
    expect(await llm2.chat({ messages: msg })).toMatchObject({ family: 'gpt' });
    expect(await llm2.chat({ messages: msg, excludeFamily: 'gpt' }).catch((e) => e)).toBeInstanceOf(
      LlmUnavailable,
    );
  });
});

describe('zero-cost rule during discovery', () => {
  it('never picks a paid OpenRouter model, even when it matches the pattern', () => {
    const or: Provider = {
      id: 'or',
      baseUrl: 'https://openrouter.ai/api/v1',
      keyEnv: 'K',
      model: 'deepseek/a:free',
      modelPattern: '^deepseek/',
      family: 'deepseek',
      limits: {},
    };
    expect(chooseModel(or, ['deepseek/paid-model', 'deepseek/b:free'])).toBe('deepseek/b:free');
    expect(chooseModel(or, ['deepseek/paid-model'])).toBeUndefined();
    expect(
      chooseModel({ ...or, family: 'deepseek' }, ['deepseek/b:free'], new Set(['deepseek'])),
    ).toBeUndefined();
  });

  it('the shipped providers give the Verifier at least two families from Gemini + Groq keys', () => {
    const fams = availableProviders(loadProviders(), {
      GEMINI_API_KEY: 'k',
      GROQ_API_KEY: 'k',
    }).map((p) => familyOf(p.model, p.family));
    expect(new Set(fams).size).toBe(2);
  });

  it('a Groq gpt-oss producer can still be verified with only Gemini + Groq keys', () => {
    const env = { GEMINI_API_KEY: 'k', GROQ_API_KEY: 'k' };
    const ids = availableProviders(loadProviders(), env, 'gpt').map((p) => p.id);
    expect(ids).toEqual(['gemini', 'groq']);
  });
});
