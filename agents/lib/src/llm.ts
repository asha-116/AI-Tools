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
    /** First-choice model. */
    model: z.string().min(1),
    /** Further models to try, in order, when the first choice no longer exists (HTTP 404). */
    models: z.array(z.string().min(1)).optional(),
    /** Last resort: any model the provider lists whose id matches this regex (stable ids only). */
    modelPattern: z.string().optional(),
    /** Family of the configured models; the family actually used is inferred from the model id. */
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

/**
 * Model family from a model id, so the Verifier's "different family" rule follows the model
 * that really answered (a provider may switch models). Falls back to the provider's family.
 */
export function familyOf(model: string, fallback: string): string {
  const id = model.toLowerCase();
  const rules: [RegExp, string][] = [
    [/gemini|gemma/, 'gemini'],
    [/gpt-oss|^openai\//, 'gpt'],
    [/llama/, 'llama'],
    [/qwen|qwq/, 'qwen'],
    [/deepseek/, 'deepseek'],
    [/mistral|mixtral|codestral/, 'mistral'],
    [/kimi|moonshot/, 'kimi'],
  ];
  for (const [re, family] of rules) if (re.test(id)) return family;
  return fallback;
}

/** Model ids we never pick automatically: previews and non-chat models. */
const NOT_FOR_CHAT =
  /preview|exp|tts|image|embed|audio|live|vision|whisper|guard|transcribe|veo|imagen/i;

/**
 * Pick the model to use from what the provider lists: the configured model, then `models` in
 * order, then the first listed id matching `modelPattern`. Returns undefined when none fits.
 */
export function chooseModel(p: Provider, listed: readonly string[]): string | undefined {
  let ids = listed.map((id) => id.replace(/^models\//, ''));
  // Zero-cost rule (AGENTS.md): on OpenRouter only `:free` models may ever be chosen.
  if (p.baseUrl?.includes('openrouter.ai')) ids = ids.filter((id) => id.endsWith(':free'));
  const available = new Set(ids);
  for (const m of [p.model, ...(p.models ?? [])]) if (available.has(m)) return m;
  if (!p.modelPattern) return undefined;
  const re = new RegExp(p.modelPattern);
  return ids.find((id) => re.test(id) && !NOT_FOR_CHAT.test(id));
}

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
  /** Retries per provider on 429/5xx/network errors (never on a timeout). Default 3. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface ResolvedProvider extends Provider {
  url: string;
  modelsUrl: string;
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
    const root = base.replace(/\/+$/, '');
    out.push({ ...p, url: `${root}/chat/completions`, modelsUrl: `${root}/models`, key });
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

/**
 * The provider's error code (e.g. Groq's `json_validate_failed`) for a 4xx other than 429, or
 * undefined. Only a short [a-z0-9_.-] code is returned — never the message, which may echo the
 * prompt. Every other body is drained unread.
 */
async function errorCode(res: Response): Promise<string | undefined> {
  if (res.status < 400 || res.status >= 500 || res.status === 429) {
    await res.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: unknown; type?: unknown };
  } | null;
  const raw = body?.error?.code ?? body?.error?.type;
  return typeof raw === 'string' && /^[a-z0-9_.-]{1,60}$/i.test(raw) ? raw : undefined;
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
  /** Model each provider actually serves this run, after any 404 → /models discovery. */
  const resolvedModel = new Map<string, string | null>();
  /**
   * Circuit breaker: providers that timed out, stayed busy after every retry, or refused the
   * key are skipped for the rest of the run, so one unhealthy provider costs minutes once.
   */
  const down = new Set<string>();

  const ListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

  /** Ask the provider which models exist and pick one (logged; ids are not secret). */
  async function discoverModel(p: ResolvedProvider): Promise<string | undefined> {
    let listed: string[];
    try {
      const res = await doFetch(p.modelsUrl, {
        headers: p.key ? { authorization: `Bearer ${p.key}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      const parsed = res.ok ? ListSchema.safeParse(await res.json().catch(() => null)) : null;
      listed = parsed?.success ? parsed.data.data.map((m) => m.id) : [];
    } catch {
      listed = [];
    }
    const chosen = chooseModel(p, listed);
    if (chosen) {
      log?.warn('llm.model_switched', { provider: p.id, from: p.model, to: chosen });
    } else {
      log?.warn('llm.model_unavailable', {
        provider: p.id,
        configured: [p.model, ...(p.models ?? [])],
        listed_count: listed.length,
        // A short sample so the owner/engineer can update providers.json.
        sample: listed.slice(0, 25),
      });
    }
    return chosen;
  }

  async function callProvider(
    p: ResolvedProvider,
    model: string,
    req: LlmRequest,
  ): Promise<{ ok: true; res: LlmResponse } | { ok: false; status: number; reason: string }> {
    const body = {
      model,
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
        // A provider that did not answer within timeoutMs is overloaded: retrying only burns
        // another full timeout of Actions minutes. Move on to the next provider instead.
        if (last.reason === 'TimeoutError' || last.reason === 'AbortError') {
          log?.warn('llm.timeout', { provider: p.id, timeout_ms: timeoutMs, attempt });
          break;
        }
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
          res: { text, provider: p.id, model, family: familyOf(model, p.family), usage },
        };
      }
      // Only a short machine-readable error code is kept; the message may echo the prompt.
      const code = await errorCode(res);
      last = {
        status: res.status,
        reason: code ? `HTTP ${res.status} ${code}` : `HTTP ${res.status}`,
      };
      // A JSON-mode answer that failed the provider's own JSON check is random: try once more.
      const badJson = code === 'json_validate_failed' && attempt === 0;
      const retryable = res.status === 429 || res.status >= 500 || badJson;
      log?.warn(retryable ? 'llm.retry' : 'llm.provider_error', {
        provider: p.id,
        status: res.status,
        ...(code ? { code } : {}),
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
      const excluded = new Set(
        (typeof req.excludeFamily === 'string'
          ? [req.excludeFamily]
          : (req.excludeFamily ?? [])
        ).map((f) => f.toLowerCase()),
      );
      for (const p of candidates) {
        let model = resolvedModel.get(p.id);
        if (model === null) continue; // discovery already found nothing usable this run
        if (down.has(p.id)) continue;
        model ??= p.model;
        if (excluded.has(familyOf(model, p.family))) continue;
        let r = await callProvider(p, model, req);
        if (!r.ok && r.status === 404 && !resolvedModel.has(p.id)) {
          // The model was renamed or retired: look up what the provider serves now, once.
          const found = await discoverModel(p);
          resolvedModel.set(p.id, found ?? null);
          if (found && found !== model && !excluded.has(familyOf(found, p.family))) {
            model = found;
            r = await callProvider(p, model, req);
          }
        } else if (r.ok) {
          resolvedModel.set(p.id, model);
        }
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
        // A 400 or a malformed answer may depend on this request; these will not change soon.
        if (
          r.status === 0 ||
          r.status === 401 ||
          r.status === 403 ||
          r.status === 429 ||
          r.status >= 500
        ) {
          down.add(p.id);
          log?.warn('llm.provider_down', { provider: p.id, status: r.status, reason: r.reason });
        }
      }
      throw new LlmUnavailable(attempts);
    },
  };
}
