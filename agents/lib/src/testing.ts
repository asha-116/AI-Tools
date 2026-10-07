// Test helpers for agents: fake fetch, fake LLM with queued replies, in-memory GitHub recorder,
// in-memory logger, and a ready-made AgentContext. Import from tests only.

import { Budget, type BudgetLimits } from './budget.js';
import { loadConfig } from './config.js';
import { escalate } from './escalate.js';
import {
  assertAgentBranch,
  commentMarker,
  type CommitStatus,
  type GitHubClient,
  type IssueSummary,
  type OpenPullRequest,
  type PullSummary,
  type WriteResult,
} from './github.js';
import type { LlmClient, LlmRequest, LlmResponse } from './llm.js';
import { createLogger, type Logger } from './log.js';
import { readAgentFile } from './prompt.js';
import type { AgentContext, RunOptions } from './run.js';

// ---------- fetch ----------

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON body, or the raw string when not JSON. */
  body: unknown;
}

export type FakeFetch = typeof fetch & { calls: RecordedRequest[] };

/** A Response with a JSON body. */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** fetch that records every request and answers with `handler` (throw to simulate a network error). */
export function fakeFetch(
  handler: (req: RecordedRequest) => Response | Promise<Response>,
): FakeFetch {
  const calls: RecordedRequest[] = [];
  const f = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const raw = typeof init.body === 'string' ? init.body : undefined;
    let body: unknown = raw;
    try {
      body = raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      // keep raw string
    }
    const req: RecordedRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body,
    };
    calls.push(req);
    return handler(req);
  };
  return Object.assign(f, { calls }) as FakeFetch;
}

/** An OpenAI-style chat completion body. */
export function completion(
  text: string,
  usage = { prompt_tokens: 10, completion_tokens: 5 },
): unknown {
  return { choices: [{ message: { role: 'assistant', content: text } }], usage };
}

// ---------- LLM ----------

export type FakeReply = string | (Partial<LlmResponse> & { text: string }) | Error;

export type FakeLlm = LlmClient & { requests: LlmRequest[]; remaining(): number };

/**
 * An LlmClient that returns queued replies in order (an Error is thrown). Charges `budget` like
 * the real client. Throws when the queue is empty so a test notices an unexpected call.
 */
export function fakeLlm(
  replies: FakeReply[],
  defaults: { provider?: string; model?: string; family?: string; budget?: Budget } = {},
): FakeLlm {
  const queue = [...replies];
  const requests: LlmRequest[] = [];
  const families = new Set<string>();
  return {
    requests,
    remaining: () => queue.length,
    familiesUsed: () => [...families],
    async chat(req) {
      defaults.budget?.assertAvailable();
      requests.push(req);
      const next = queue.shift();
      if (next === undefined) throw new Error('fakeLlm: no queued reply left');
      if (next instanceof Error) throw next;
      const r: LlmResponse = {
        provider: defaults.provider ?? 'fake',
        model: defaults.model ?? 'fake-model',
        family: defaults.family ?? 'fake',
        usage: { prompt: 10, completion: 5 },
        ...(typeof next === 'string' ? { text: next } : next),
      };
      families.add(r.family);
      defaults.budget?.charge(r.usage);
      return r;
    },
  };
}

// ---------- GitHub ----------

export interface RecordedWrite {
  action: 'createIssue' | 'upsertComment' | 'addLabels' | 'openPullRequest' | 'setCommitStatus';
  args: unknown;
}

/** In-memory GitHub: reads come from seeded data, writes are recorded and applied in memory. */
export class MemoryGitHub implements GitHubClient {
  readonly agent: string;
  readonly dryRun: boolean;
  readonly issues: IssueSummary[];
  readonly pulls: PullSummary[];
  readonly files: Map<string, string>;
  readonly comments = new Map<number, string[]>();
  readonly writes: RecordedWrite[] = [];
  private nextNumber: number;

  constructor(
    seed: {
      agent?: string;
      dryRun?: boolean;
      issues?: Partial<IssueSummary>[];
      pulls?: PullSummary[];
      files?: Record<string, string>;
    } = {},
  ) {
    this.agent = seed.agent ?? 'test';
    this.dryRun = seed.dryRun ?? false;
    this.issues = (seed.issues ?? []).map((i, n) => ({
      number: n + 1,
      title: '',
      body: '',
      labels: [],
      state: 'open',
      html_url: `memory://issues/${i.number ?? n + 1}`,
      updated_at: '2026-01-01T00:00:00Z',
      is_pull_request: false,
      ...i,
    }));
    this.pulls = seed.pulls ?? [];
    this.files = new Map(Object.entries(seed.files ?? {}));
    this.nextNumber =
      Math.max(0, ...this.issues.map((i) => i.number), ...this.pulls.map((p) => p.number)) + 1;
  }

  private result(number: number): WriteResult {
    return { dryRun: this.dryRun, number, html_url: `memory://issues/${number}` };
  }

  async listIssues(
    q: { state?: 'open' | 'closed' | 'all'; labels?: string[]; limit?: number } = {},
  ) {
    const state = q.state ?? 'open';
    return this.issues
      .filter((i) => state === 'all' || i.state === state)
      .filter((i) => (q.labels ?? []).every((l) => i.labels.includes(l)))
      .slice(0, q.limit ?? 100);
  }

  async listPulls(q: { state?: 'open' | 'closed' | 'all'; head?: string; limit?: number } = {}) {
    const state = q.state ?? 'open';
    return this.pulls
      .filter((p) => state === 'all' || p.state === state)
      .filter((p) => q.head === undefined || p.head.ref === q.head)
      .slice(0, q.limit ?? 100);
  }

  /** Case-insensitive substring match on title + body (ignores GitHub search qualifiers). */
  async searchIssues(query: string, limit = 100) {
    const words = query
      .split(/\s+/)
      .filter((w) => w && !w.includes(':'))
      .map((w) => w.toLowerCase());
    return this.issues
      .filter((i) => words.every((w) => `${i.title}\n${i.body}`.toLowerCase().includes(w)))
      .slice(0, limit);
  }

  async getFile(path: string) {
    return this.files.get(path) ?? null;
  }

  async createIssue(issue: { title: string; body: string; labels?: string[] }) {
    this.writes.push({ action: 'createIssue', args: issue });
    const number = this.nextNumber++;
    this.issues.push({
      number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels ?? [],
      state: 'open',
      html_url: `memory://issues/${number}`,
      updated_at: '2026-01-01T00:00:00Z',
      is_pull_request: false,
    });
    return this.result(number);
  }

  async upsertComment(issueNumber: number, body: string) {
    this.writes.push({ action: 'upsertComment', args: { issueNumber, body } });
    const marker = commentMarker(this.agent);
    const list = this.comments.get(issueNumber) ?? [];
    const full = body.includes(marker) ? body : `${marker}\n${body}`;
    const idx = list.findIndex((c) => c.includes(marker));
    if (idx >= 0) list[idx] = full;
    else list.push(full);
    this.comments.set(issueNumber, list);
    return { ...this.result(issueNumber), updated: idx >= 0 };
  }

  async addLabels(issueNumber: number, labels: string[]) {
    this.writes.push({ action: 'addLabels', args: { issueNumber, labels } });
    const issue = this.issues.find((i) => i.number === issueNumber);
    if (issue) issue.labels = [...new Set([...issue.labels, ...labels])];
    return this.result(issueNumber);
  }

  async openPullRequest(pr: OpenPullRequest) {
    assertAgentBranch(pr.branch, this.agent);
    this.writes.push({ action: 'openPullRequest', args: pr });
    const number = this.nextNumber++;
    this.pulls.push({
      number,
      title: pr.title,
      body: pr.body,
      labels: pr.labels ?? [],
      state: 'open',
      html_url: `memory://pulls/${number}`,
      head: { ref: pr.branch, sha: '0'.repeat(40) },
      base: pr.base ?? 'main',
      draft: pr.draft ?? false,
      updated_at: '2026-01-01T00:00:00Z',
    });
    return this.result(number);
  }

  async setCommitStatus(sha: string, status: CommitStatus) {
    this.writes.push({ action: 'setCommitStatus', args: { sha, ...status } });
    return this.result(0);
  }
}

// ---------- logger ----------

export type MemoryLogger = Logger & { lines: Record<string, unknown>[] };

/** A logger that keeps parsed lines in memory (scrubbing still applies). */
export function memoryLogger(agent = 'test', secrets: string[] = []): MemoryLogger {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    agent,
    dir: 'memory',
    secrets,
    echo: null,
    write: (_path, line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return Object.assign(logger, { lines });
}

// ---------- contexts ----------

/** RunOptions for runAgent() with every external dependency faked. Override any field. */
export function testRunOptions(agent: string, overrides: RunOptions = {}): RunOptions {
  return {
    env: { DRY_RUN: 'true' },
    llm: fakeLlm([]),
    github: new MemoryGitHub({ agent, dryRun: true }),
    logger: memoryLogger(agent),
    usedToday: 0,
    ...overrides,
  };
}

/** An AgentContext for unit-testing an agent's core function without runAgent(). */
export function testContext(
  agent: string,
  overrides: {
    llm?: LlmClient;
    github?: GitHubClient;
    logger?: Logger;
    budget?: number | BudgetLimits;
    env?: Record<string, string>;
    repoRoot?: string;
    now?: () => Date;
  } = {},
): AgentContext {
  const config = loadConfig(overrides.env ?? { DRY_RUN: 'true' }, overrides.repoRoot);
  const github = overrides.github ?? new MemoryGitHub({ agent, dryRun: config.dryRun });
  return {
    name: agent,
    config,
    dryRun: config.dryRun,
    log: overrides.logger ?? memoryLogger(agent),
    budget: new Budget(agent, overrides.budget ?? 100_000),
    llm: overrides.llm ?? fakeLlm([]),
    github,
    escalate: (req) => escalate(github, agent, req),
    readFile: (file) => readAgentFile(config.repoRoot, agent, file),
    now: overrides.now ?? (() => new Date('2026-01-01T00:00:00Z')),
  };
}
