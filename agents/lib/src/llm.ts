// OpenAI-compatible chat completions with ordered free-tier fallback (ADR-013).
// Never logs prompts, replies or keys — only provider, model, status and token counts.

import { z } from 'zod';
import type { Budget, Usage } from './budget.js';
import type { Env } from './config.js';
import { LlmUnavailable } from './errors.js';
import type { Logger } from './log.js';
import providersFile from './providers.json' with { type: 'json' };

export const ProviderSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    baseUrl: z.url().optional(),
    /** Env var holding the base URL (e.g. local Ollama); used when baseUrl is absent. */
    baseUrlEnv: z.string().optional(),
    /** Env var holding the API key. Omit for keyless local providers. */
    keyEnv: z.string().optional(),
    model: z.string().min(1),
    family: z.string().min(1),
    limits: z
      .object({
        rpm: z.number().int().positive().optional(),
        rpd: z.number().int().positive().optional(),
        maxOutputTokens: z.number().int().positive().optional(),
      })
      .default({}),
  })
  .refine((p) => p.baseUrl !== undefined || p.baseUrlEnv !== undefined, {
    message: 'baseUrl or baseUrlEnv is required',
  })
  .refine((p) => !p.baseUrl?.includes('openrouter.ai') || p.model.endsWith(':free'), {
    message: 'OpenRouter models must be :free (zero-cost rule)',
  });

export type Provider = z.infer<typeof ProviderSchema>;

/** The providers from providers.json, validated. */
export function loadProviders(json: unknown = providersFile): Provider[] {
  return z.object({ providers: z.array(ProviderSchema).min(1) }).parse(json).providers;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: ChatMessage[];
  /** Ask for a JSON object (`response_format: json_object`). Still validate with schema.ts. */
  jsonMode?: boolean;
  /** Skip providers of these model families (the Verifier excludes the producer's family). */
  excludeFamily?: string | readonly string[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  provider: string;
  model: string;
  family: string;
  usage: Usage;
}

export interface LlmClient {
  chat(request: LlmRequest): Promise<LlmResponse>;
  /** Distinct model families that answered in this run (record as the producer family). */
  familiesUsed(): string[];
}

export interface LlmOptions {
  env: Env;
  providers?: Provider[];
  fetch?: typeof fetch;
  logger?: Logger;
  /** Checked before and charged after every call. */
  budget?: Budget;
  /** Retries per provider on 429/5xx/network errors. Default 3. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface ResolvedProvider extends Provider {
  url: string;
  key: string | undefined;
}

/** Providers with a key (and base URL) set, in order, minus excluded families. */
export function availableProviders(
  providers: Provider[],
  env: Env,
  excludeFamily: string | readonly string[] = [],
): ResolvedProvider[] {
  const excluded = new Set(
    (typeof excludeFamily === 'string' ? [excludeFamily] : excludeFamily).map((f) =>
      f.toLowerCase(),
    ),
  );
  const out: ResolvedProvider[] = [];
  for (const p of providers) {
    if (excluded.has(p.family.toLowerCase())) continue;
    const key = p.keyEnv ? env[p.keyEnv] : undefined;
    if (p.keyEnv && !key) continue;
    const base = p.baseUrl ?? (p.baseUrlEnv ? env[p.baseUrlEnv] : undefined);
    if (!base) continue;
    out.push({ ...p, url: `${base.replace(/\/+$/, '')}/chat/completions`, key });
  }
  return out;
}

/** Exponential backoff with jitter: base·2^attempt, capped, scaled by 0.5–1.0. */
export function backoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(cap * (0.5 + random() * 0.5));
}

const CompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .nullish(),
  model: z.string().optional(),
});

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response, maxDelayMs: number): number | undefined {
  const v = res.headers.get('retry-after');
  if (!v) return undefined;
  const s = Number(v);
  return Number.isFinite(s) && s >= 0 ? Math.min(maxDelayMs, s * 1000) : undefined;
}

/** Rough token estimate for providers that omit `usage` (≈ 4 chars per token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createLlm(options: LlmOptions): LlmClient {
  const providers = options.providers ?? loadProviders();
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const log = options.logger;
  const families = new Set<string>();

  async function callProvider(
    p: ResolvedProvider,
    req: LlmRequest,
  ): Promise<{ ok: true; res: LlmResponse } | { ok: false; status: number; reason: string }> {
    const body = {
      model: p.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      ...(req.maxTokens || p.limits.maxOutputTokens
        ? { max_tokens: req.maxTokens ?? p.limits.maxOutputTokens }
        : {}),
      ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };
    let last = { status: 0, reason: 'not tried' };
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let res: Response;
      try {
        res = await doFetch(p.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(p.key ? { authorization: `Bearer ${p.key}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        last = { status: 0, reason: e instanceof Error ? e.name : 'network' };
        log?.warn('llm.retry', { provider: p.id, status: 0, attempt });
        if (attempt < maxRetries) await sleep(backoffMs(attempt, baseDelayMs, maxDelayMs, random));
        continue;
      }
      if (res.ok) {
        const parsed = CompletionSchema.safeParse(await res.json().catch(() => null));
        const text = parsed.success ? (parsed.data.choices[0]?.message.content ?? '') : '';
        if (!parsed.success || text.trim() === '') {
          // A malformed or empty answer will not improve by retrying the same provider.
          return { ok: false, status: res.status, reason: 'empty or malformed response' };
        }
        const u = parsed.data.usage;
        const usage: Usage = {
          prompt: u?.prompt_tokens ?? estimateTokens(req.messages.map((m) => m.content).join('')),
          completion: u?.completion_tokens ?? estimateTokens(text),
        };
        return {
          ok: true,
          res: { text, provider: p.id, model: p.model, family: p.family, usage },
        };
      }
      last = { status: res.status, reason: `HTTP ${res.status}` };
      // Drain the body without reading it into logs (it may echo the prompt).
      await res.body?.cancel().catch(() => undefined);
      const retryable = res.status === 429 || res.status >= 500;
      log?.warn(retryable ? 'llm.retry' : 'llm.provider_error', {
        provider: p.id,
        status: res.status,
        attempt,
      });
      if (!retryable) break;
      if (attempt < maxRetries) {
        await sleep(
          retryAfterMs(res, maxDelayMs) ?? backoffMs(attempt, baseDelayMs, maxDelayMs, random),
        );
      }
    }
    return { ok: false, ...last };
  }

  return {
    familiesUsed: () => [...families],
    async chat(req) {
      options.budget?.assertAvailable();
      const candidates = availableProviders(providers, options.env, req.excludeFamily);
      const attempts: LlmUnavailable['attempts'] = [];
      for (const p of candidates) {
        const r = await callProvider(p, req);
        if (r.ok) {
          families.add(r.res.family);
          log?.info('llm.usage', {
            provider: r.res.provider,
            model: r.res.model,
            family: r.res.family,
            prompt_tokens: r.res.usage.prompt,
            completion_tokens: r.res.usage.completion,
          });
          options.budget?.charge(r.res.usage);
          return r.res;
        }
        attempts.push({ provider: p.id, status: r.status, reason: r.reason });
        log?.warn('llm.fallback', { provider: p.id, status: r.status, reason: r.reason });
      }
      throw new LlmUnavailable(attempts);
    },
  };
}
