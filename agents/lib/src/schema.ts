// Validate LLM JSON with zod (ADR-012): invalid → retry once with the error → Escalation.

import { z } from 'zod';
import { Escalation, LlmUnavailable } from './errors.js';
import type { LlmClient, LlmRequest, LlmResponse } from './llm.js';
import type { Logger } from './log.js';

/** Parse JSON from an LLM reply, tolerating a ```json fence or text around one object/array. */
export function parseJsonLoose(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? (fenced[1] as string) : text).trim();
  try {
    return JSON.parse(body);
  } catch (first) {
    const start = body.search(/[[{]/);
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw first;
  }
}

/** Human-readable reason, bounded in length so it fits back into a prompt. */
function describe(error: unknown): string {
  const msg =
    error instanceof z.ZodError
      ? z.prettifyError(error)
      : `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
  return msg.length > 1500 ? `${msg.slice(0, 1500)}…` : msg;
}

function check<S extends z.ZodType>(
  schema: S,
  text: string,
): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  try {
    const parsed = schema.safeParse(parseJsonLoose(text));
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, error: describe(parsed.error) };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/**
 * Call `call()` (an LLM request returning raw text), validate the JSON against `schema`.
 * On failure call once more with `feedback` = the validation error; if still invalid, throw
 * an Escalation so runAgent() opens a `needs-owner` Issue.
 */
export async function validateWithRetry<S extends z.ZodType>(
  call: (feedback?: string) => Promise<string>,
  schema: S,
  label = 'LLM output',
  /** Told about each invalid reply (the validation error names fields, never the reply). */
  onInvalid?: (error: string, attempt: number) => void,
): Promise<z.infer<S>> {
  const first = check(schema, await call());
  if (first.ok) return first.data;
  onInvalid?.(first.error, 0);
  const second = check(schema, await call(first.error));
  if (second.ok) return second.data;
  onInvalid?.(second.error, 1);
  throw new Escalation({
    title: `Invalid ${label} after retry`,
    context: `The model returned output that failed schema validation twice.\n\nLast error:\n${second.error}`,
    options: [
      'Re-run the workflow later (free models vary run to run).',
      'Tighten prompt.md / the schema, then re-run.',
      'Do the task by hand and close this Issue.',
    ],
    recommendation: 'Re-run once; if it fails again, tighten the prompt.',
    key: `invalid-output-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  });
}

/**
 * The usual case: chat in JSON mode and validate. On a retry the model sees its previous answer
 * and the validation error. If that model fails twice, a model of another family gets the same
 * two tries before anyone is asked: free models differ a lot in how well they follow a schema.
 * Returns the data and the response that produced it (for `family`).
 */
export async function chatJson<S extends z.ZodType>(
  llm: LlmClient,
  request: LlmRequest,
  schema: S,
  label?: string,
  options: { log?: Logger } = {},
): Promise<{ data: z.infer<S>; response: LlmResponse }> {
  let response: LlmResponse | undefined;
  const attempt = (req: LlmRequest): Promise<z.infer<S>> => {
    response = undefined;
    return validateWithRetry(
      async (feedback) => {
        const messages =
          feedback === undefined || response === undefined
            ? req.messages
            : [
                ...req.messages,
                { role: 'assistant' as const, content: response.text },
                {
                  role: 'user' as const,
                  content: `Your previous reply was invalid:\n${feedback}\nReply again with only the corrected JSON.`,
                },
              ];
        response = await llm.chat({ ...req, messages, jsonMode: req.jsonMode ?? true });
        return response.text;
      },
      schema,
      label,
      (error, n) =>
        options.log?.warn('llm.invalid_output', {
          label: label ?? 'LLM output',
          provider: response?.provider,
          model: response?.model,
          attempt: n,
          error,
        }),
    );
  };

  let data: z.infer<S>;
  try {
    data = await attempt(request);
  } catch (e) {
    const failed = response?.family;
    if (!(e instanceof Escalation) || failed === undefined) throw e;
    const excluded =
      typeof request.excludeFamily === 'string'
        ? [request.excludeFamily]
        : [...(request.excludeFamily ?? [])];
    try {
      data = await attempt({ ...request, excludeFamily: [...excluded, failed] });
    } catch (e2) {
      // No other family available: report the original invalid output.
      if (e2 instanceof LlmUnavailable) throw e;
      throw e2;
    }
  }
  return { data, response: response as unknown as LlmResponse };
}
