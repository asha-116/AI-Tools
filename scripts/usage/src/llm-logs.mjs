// Totals agent LLM token usage from the JSON-lines run logs in company/reports/agent-logs/.
// Tolerant by design: the log format is owned by agents/lib and may evolve, so unknown or
// broken lines are counted and skipped, never fatal.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * @typedef {import('./core.mjs').LlmSummary} LlmSummary
 * @typedef {import('./core.mjs').LlmAgentTotal} LlmAgentTotal
 */

/** First finite non-negative number among the candidates. */
function num(/** @type {unknown[]} */ ...candidates) {
  for (const c of candidates) {
    const n = typeof c === 'string' && c.trim() !== '' ? Number(c) : c;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

/** YYYY-MM of an ISO-ish timestamp field, or of a YYYY-MM(-DD) in the file path. */
function monthOf(/** @type {any} */ entry, /** @type {string} */ path) {
  for (const k of ['ts', 'time', 'timestamp', 'at', 'date']) {
    const v = entry[k];
    if (typeof v === 'string' && /^\d{4}-\d{2}/.test(v)) return v.slice(0, 7);
    if (typeof v === 'number' && v > 1e12) return new Date(v).toISOString().slice(0, 7);
  }
  const m = /(\d{4})-(\d{2})(?:-\d{2})?/.exec(path);
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * Parses one log file's text and adds the LLM calls of `month` to `acc`.
 * Accepts `usage.{prompt,completion}` and the common provider spellings
 * (`prompt_tokens`/`completion_tokens`, `input_tokens`/`output_tokens`, `input`/`output`).
 * @param {string} text
 * @param {{ month: string, path?: string }} opts
 * @param {LlmSummary} [acc]
 * @returns {LlmSummary}
 */
export function addLlmLog(text, { month, path = '' }, acc = emptySummary()) {
  /** @type {Map<string, LlmAgentTotal>} */
  const byAgent = new Map(acc.agents.map((a) => [a.agent, { ...a }]));
  let { undated, malformed } = acc;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      malformed++;
      continue;
    }
    if ((entry.evt ?? entry.event ?? entry.type) !== 'llm') continue;
    const m = monthOf(entry, path);
    if (!m) {
      undated++;
      continue;
    }
    if (m !== month) continue;
    const u = entry.usage && typeof entry.usage === 'object' ? entry.usage : {};
    const prompt = num(u.prompt, u.prompt_tokens, u.input_tokens, u.input);
    const completion = num(u.completion, u.completion_tokens, u.output_tokens, u.output);
    const agent =
      typeof entry.agent === 'string' && entry.agent.trim() ? entry.agent.trim() : 'unknown';
    const t = byAgent.get(agent) ?? { agent, calls: 0, prompt: 0, completion: 0 };
    t.calls += 1;
    t.prompt += prompt;
    t.completion += completion;
    byAgent.set(agent, t);
  }
  return {
    agents: [...byAgent.values()].sort((a, b) => a.agent.localeCompare(b.agent)),
    files: acc.files + 1,
    undated,
    malformed,
  };
}

/** @returns {LlmSummary} */
export function emptySummary() {
  return { agents: [], files: 0, undated: 0, malformed: 0 };
}

/**
 * Reads every *.jsonl file under `dir` (recursively). A missing directory → empty summary.
 * @param {string} dir
 * @param {string} month YYYY-MM
 * @returns {Promise<LlmSummary>}
 */
export async function collectLlmTokens(dir, month) {
  /** @type {string[]} */
  let files;
  try {
    files = (await readdir(dir, { recursive: true, withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
      .map((d) => join(d.parentPath, d.name))
      .sort();
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return emptySummary();
    throw e;
  }
  let acc = emptySummary();
  for (const f of files) {
    acc = addLlmLog(await readFile(f, 'utf8'), { month, path: relative(dir, f) }, acc);
  }
  return acc;
}
