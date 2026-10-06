// runAgent(): the one entry point every agent's src/run.ts uses. It wires config, logger,
// budget, LLM and GitHub; turns Escalation into a `needs-owner` Issue; stops cleanly on
// BudgetExceeded; and always writes a final `run.end` log line (read back for daily budgets).

import { Budget, type BudgetLimits, tokensUsedInLog } from './budget.js';
import { type AgentConfig, type Env, loadConfig, secretValues } from './config.js';
import { BudgetExceeded, Escalation, type EscalationRequest } from './errors.js';
import { escalate } from './escalate.js';
import { GitHub, type GitHubClient, type WriteResult } from './github.js';
import { createLlm, type LlmClient, type Provider } from './llm.js';
import { createLogger, type Logger, scrubString } from './log.js';
import { readAgentFile } from './prompt.js';

/** Used when GITHUB_REPOSITORY is unset (local dry runs). */
export const DEFAULT_REPOSITORY = 'asha-116/AI-Tools';

export interface AgentContext {
  readonly name: string;
  readonly config: AgentConfig;
  readonly dryRun: boolean;
  readonly log: Logger;
  readonly budget: Budget;
  readonly llm: LlmClient;
  readonly github: GitHubClient;
  /** Open (or refresh) a `needs-owner` Issue without stopping the run. */
  escalate(req: EscalationRequest): Promise<WriteResult & { deduped: boolean }>;
  /** Read `agents/<name>/<file>` (e.g. prompt.md). */
  readFile(file: string): string;
  now(): Date;
}

export type RunStatus = 'ok' | 'budget_exceeded' | 'escalated' | 'error';

export interface RunResult<T> {
  status: RunStatus;
  result?: T;
  /** Tokens used in this run. */
  tokens: number;
  /** Error message (scrubbed) for budget_exceeded / escalated / error. */
  error?: string;
  /** The `needs-owner` Issue opened or refreshed for an Escalation. */
  escalation?: WriteResult & { deduped: boolean };
}

/** Everything is injectable so tests never touch the network, the clock or the repo. */
export interface RunOptions {
  env?: Env;
  cwd?: string;
  /** Used by both the LLM and GitHub clients unless those are given directly. */
  fetch?: typeof fetch;
  llm?: LlmClient;
  github?: GitHubClient;
  logger?: Logger;
  logDir?: string;
  providers?: Provider[];
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Tokens already used today; default: read from today's log file. */
  usedToday?: number;
}

const AGENT_NAME = /^[a-z][a-z0-9-]*$/;

export async function runAgent<T>(
  name: string,
  budgetLimits: number | BudgetLimits,
  fn: (ctx: AgentContext) => Promise<T>,
  options: RunOptions = {},
): Promise<RunResult<T>> {
  if (!AGENT_NAME.test(name)) throw new Error(`invalid agent name "${name}"`);
  const env = options.env ?? process.env;
  const config = loadConfig(env, options.cwd);
  const now = options.now ?? (() => new Date());
  const secrets = secretValues(env);
  const log =
    options.logger ??
    createLogger({
      agent: name,
      repoRoot: config.repoRoot,
      secrets,
      now,
      ...(options.logDir ? { dir: options.logDir } : {}),
      ...(env.GITHUB_RUN_ID ? { runId: env.GITHUB_RUN_ID } : {}),
    });
  const budget = new Budget(name, budgetLimits, options.usedToday ?? tokensUsedInLog(log.path));
  const llm =
    options.llm ??
    createLlm({
      env,
      logger: log,
      budget,
      ...(options.providers ? { providers: options.providers } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      ...(options.random ? { random: options.random } : {}),
    });
  const github =
    options.github ??
    new GitHub({
      agent: name,
      repository: env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
      token: config.githubToken,
      dryRun: config.dryRun,
      logger: log,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  const runUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined;
  const escalateOpts = { ...(runUrl ? { runUrl } : {}), now: now() };

  const ctx: AgentContext = {
    name,
    config,
    dryRun: config.dryRun,
    log,
    budget,
    llm,
    github,
    escalate: (req) => escalate(github, name, req, escalateOpts),
    readFile: (file) => readAgentFile(config.repoRoot, name, file),
    now,
  };

  const started = now().getTime();
  log.info('run.start', {
    dry_run: config.dryRun,
    budget_run: budget.perRun,
    budget_daily: budget.daily,
    used_before_run: budget.usedBeforeRun,
  });

  let out: RunResult<T>;
  try {
    const result = await fn(ctx);
    out = { status: 'ok', result, tokens: budget.used };
  } catch (e) {
    const message = scrubString(e instanceof Error ? e.message : String(e), secrets);
    if (e instanceof BudgetExceeded) {
      log.warn('budget.exceeded', { scope: e.scope, limit: e.limit, used: e.used });
      out = { status: 'budget_exceeded', tokens: budget.used, error: message };
    } else if (e instanceof Escalation) {
      try {
        const escalation = await ctx.escalate(e.request);
        log.warn('escalated', { issue: escalation.number, deduped: escalation.deduped });
        out = { status: 'escalated', tokens: budget.used, error: message, escalation };
      } catch (inner) {
        log.error('escalation.failed', { error: inner });
        out = { status: 'error', tokens: budget.used, error: message };
      }
    } else {
      log.error('run.error', { error: e });
      out = { status: 'error', tokens: budget.used, error: message };
    }
  }
  log.info('run.end', {
    status: out.status,
    tokens: out.tokens,
    duration_ms: now().getTime() - started,
    families: llm.familiesUsed(),
    dry_run: config.dryRun,
  });
  return out;
}

/** Process exit code for a run: only unexpected errors fail the workflow. */
export function exitCode(result: RunResult<unknown>): number {
  return result.status === 'error' ? 1 : 0;
}
