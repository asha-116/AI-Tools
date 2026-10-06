// JSON-lines run logs: company/reports/agent-logs/<agent>/<YYYY-MM-DD>.jsonl (UTC date).
// Every string is scrubbed of secrets and redacted of PII before it is written.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redact } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogData = Record<string, unknown>;

export interface Logger {
  readonly agent: string;
  /** File the logger appends to. */
  readonly path: string;
  debug(event: string, data?: LogData): void;
  info(event: string, data?: LogData): void;
  warn(event: string, data?: LogData): void;
  error(event: string, data?: LogData): void;
}

export interface LoggerOptions {
  agent: string;
  /** Directory holding one folder per agent. Default `<repoRoot>/company/reports/agent-logs`. */
  dir?: string;
  repoRoot?: string;
  /** Exact secret values to remove (see config.secretValues). */
  secrets?: readonly string[];
  now?: () => Date;
  /** Run id added to every line (e.g. GITHUB_RUN_ID). */
  runId?: string;
  /** Replace the file append (tests). */
  write?: (path: string, line: string) => void;
  /** Also print each line (Actions log). Default: process.stdout. Pass null to silence. */
  echo?: ((line: string) => void) | null;
}

// Common key formats. Kept broad on purpose: over-scrubbing a log is harmless.
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI / OpenRouter (sk-or-v1-…)
  /\bgsk_[A-Za-z0-9]{16,}/g, // Groq
  /\bcsk-[A-Za-z0-9]{16,}/g, // Cerebras
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google / Gemini
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\brzp_(?:live|test)_[A-Za-z0-9]{8,}/g, // Razorpay key ids
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

// Fields that must never be logged, whatever their content.
const FORBIDDEN_FIELDS =
  /^(prompt|prompts|messages|apikey|api_key|authorization|token|secret|password)$/i;

export function scrubString(value: string, secrets: readonly string[] = []): string {
  let out = value;
  for (const s of secrets) if (s) out = out.split(s).join('[SECRET]');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[SECRET]');
  return redact(out).text;
}

/** Deep-copy `value`, scrubbing every string and dropping forbidden fields. */
export function scrub(value: unknown, secrets: readonly string[] = [], depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value, secrets);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[DEPTH]';
  if (value instanceof Error)
    return { name: value.name, message: scrubString(value.message, secrets) };
  if (Array.isArray(value)) return value.map((v) => scrub(v, secrets, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = FORBIDDEN_FIELDS.test(k) ? '[OMITTED]' : scrub(v, secrets, depth + 1);
  }
  return out;
}

export function logPath(dir: string, agent: string, date: Date): string {
  return join(dir, agent, `${date.toISOString().slice(0, 10)}.jsonl`);
}

export function defaultLogDir(repoRoot: string): string {
  return join(repoRoot, 'company', 'reports', 'agent-logs');
}

function appendLine(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line);
}

export function createLogger(options: LoggerOptions): Logger {
  const now = options.now ?? (() => new Date());
  const dir = options.dir ?? defaultLogDir(options.repoRoot ?? process.cwd());
  const write = options.write ?? appendLine;
  const echo =
    options.echo === undefined ? (line: string) => process.stdout.write(line) : options.echo;
  const secrets = options.secrets ?? [];
  const path = logPath(dir, options.agent, now());

  const emit = (level: LogLevel, event: string, data: LogData = {}): void => {
    const record = {
      ts: now().toISOString(),
      agent: options.agent,
      ...(options.runId ? { run_id: options.runId } : {}),
      level,
      event: scrubString(event, secrets),
      ...(scrub(data, secrets) as LogData),
    };
    const line = `${JSON.stringify(record)}\n`;
    write(path, line);
    echo?.(line);
  };

  return {
    agent: options.agent,
    path,
    debug: (e, d) => emit('debug', e, d),
    info: (e, d) => emit('info', e, d),
    warn: (e, d) => emit('warn', e, d),
    error: (e, d) => emit('error', e, d),
  };
}
