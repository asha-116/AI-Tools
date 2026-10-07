// Wires runController() (src/run.ts) to the shared agent runtime for `npm run agent -- controller`:
// clock, fetch and env from the runner; files relative to the repo root; D1 orders via wrangler;
// GitHub writes through the lib client (dry-run by default); log lines through the lib logger.
//
// Not configured (no Razorpay keys, or no Cloudflare token / account / ORDERS_D1_ID) → logs
// `controller.not_configured` and exits 0. Both are needed: reconciling payments without the
// delivery log would report every payment as a mismatch.

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { runAgent, type AgentContext, type Env, type RunOptions } from '../../lib/src/index.js';
import type { FetchLike } from './razorpay.js';
import { RAZORPAY_ENV } from './razorpay.js';
import {
  runController,
  SQL_EXPORT,
  type ControllerDeps,
  type ControllerOptions,
  type ControllerResult,
} from './run.js';

/** PROCEDURE.md "Token budget per run" (summary only; the pipeline itself uses no LLM). */
export const BUDGET = { perRun: 5_000, daily: 10_000 } as const;
export const ORDERS_DB = 'toolshop-orders';
export const DEFAULT_WRANGLER = 'npx --yes wrangler@4.143.0';
export const CLOUDFLARE_ENV = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'ORDERS_D1_ID'];

export type ExecFn = (
  file: string,
  args: readonly string[],
  options: { cwd: string; env: Env; maxBuffer: number },
) => Promise<{ stdout: string }>;

const execFileP = promisify(execFile);

export const defaultExec: ExecFn = async (file, args, options) => {
  const { stdout } = await execFileP(file, [...args], {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    maxBuffer: options.maxBuffer,
    encoding: 'utf8',
  });
  return { stdout };
};

/** Names of required env vars that are unset, per service. */
export function missingConfig(env: Env): { razorpay: string[]; cloudflare: string[] } {
  return {
    razorpay: [RAZORPAY_ENV.keyId, RAZORPAY_ENV.keySecret].filter((k) => !env[k]),
    cloudflare: CLOUDFLARE_ENV.filter((k) => !env[k]),
  };
}

/** Minimal wrangler config naming the orders database (the repo's own files stay untouched). */
export function wranglerConfig(databaseId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)) {
    throw new Error('ORDERS_D1_ID must be a UUID');
  }
  return [
    'name = "toolshop-controller"',
    'compatibility_date = "2026-09-01"',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = "${ORDERS_DB}"`,
    `database_id = "${databaseId}"`,
    '',
  ].join('\n');
}

/** Parse `wrangler d1 execute --json` stdout, tolerating log lines around the JSON. */
export function parseWranglerJson(stdout: string): unknown {
  let doc: unknown;
  try {
    doc = JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf('[');
    const end = stdout.lastIndexOf(']');
    if (start < 0 || end <= start) throw new Error('wrangler output has no JSON');
    doc = JSON.parse(stdout.slice(start, end + 1));
  }
  for (const r of Array.isArray(doc) ? doc : [doc]) {
    if (r !== null && typeof r === 'object' && (r as { success?: unknown }).success === false) {
      throw new Error('D1 query failed');
    }
  }
  return doc;
}

/** `readD1Orders` for ControllerDeps: runs SQL_EXPORT against the remote orders database. */
export function d1OrdersReader(env: Env, exec: ExecFn = defaultExec): () => Promise<unknown> {
  return async () => {
    const config = wranglerConfig(env['ORDERS_D1_ID'] ?? '');
    const [cmd, ...pre] = (env['WRANGLER'] || DEFAULT_WRANGLER).split(/\s+/).filter(Boolean);
    const tmp = mkdtempSync(join(tmpdir(), 'controller-d1-'));
    try {
      const file = join(tmp, 'wrangler.toml');
      writeFileSync(file, config);
      const { stdout } = await exec(
        cmd ?? 'npx',
        [
          ...pre,
          'd1',
          'execute',
          ORDERS_DB,
          '--remote',
          '--json',
          '--config',
          file,
          '--command',
          SQL_EXPORT,
        ],
        { cwd: tmp, env, maxBuffer: 64 * 1024 * 1024 },
      );
      return parseWranglerJson(stdout);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };
}

/** Repo-relative path → absolute, refusing anything that escapes the repo. */
export function repoPath(root: string, path: string): string {
  if (!path || path.startsWith('/') || path.split(/[\\/]/).some((s) => s === '..' || s === '')) {
    throw new Error(`refusing unsafe path "${path}"`);
  }
  return join(root, path);
}

export interface WiringOptions {
  fetch?: FetchLike;
  exec?: ExecFn;
}

/** ControllerDeps backed by the agent context. */
export function controllerDeps(ctx: AgentContext, o: WiringOptions = {}): ControllerDeps {
  const root = ctx.config.repoRoot;
  const env = ctx.config.env;
  const read = (path: string): string | null => {
    try {
      return readFileSync(repoPath(root, path), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  };
  return {
    now: ctx.now,
    fetch: o.fetch ?? (fetch as unknown as FetchLike),
    env,
    readFile: async (path) => read(path),
    writeFile: async (path, contents) => {
      const full = repoPath(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    },
    readD1Orders: d1OrdersReader(env, o.exec),
    github: {
      createIssue: async (issue) => {
        const r = await ctx.github.createIssue(issue);
        ctx.log.info('issue', { number: r.number, dry_run: r.dryRun, labels: issue.labels });
      },
      openPullRequest: async (pr) => {
        const files = pr.paths.map((path) => {
          const content = read(path);
          if (content === null) throw new Error(`${path} was not written`);
          return { path, content };
        });
        const r = await ctx.github.openPullRequest({
          branch: pr.branch,
          title: pr.title,
          body: pr.body,
          labels: pr.labels,
          files,
        });
        ctx.log.info('pull_request', { number: r.number, dry_run: r.dryRun, branch: pr.branch });
      },
    },
    log: (event, data) => ctx.log.info(event, data),
  };
}

export type ControllerRunResult =
  ({ status: 'done' } & ControllerResult) | { status: 'not_configured'; missing: string[] };

/** Skips cleanly when not configured; otherwise runs the pipeline. */
export async function controller(
  ctx: AgentContext,
  o: WiringOptions & { controller?: ControllerOptions } = {},
): Promise<ControllerRunResult> {
  const missing = missingConfig(ctx.config.env);
  const all = [...missing.razorpay, ...missing.cloudflare];
  if (all.length > 0) {
    ctx.log.info('controller.not_configured', {
      missing: all,
      note: 'Razorpay keys and the Cloudflare token/account/ORDERS_D1_ID are all needed; skipping.',
    });
    return { status: 'not_configured', missing: all };
  }
  const result = await runController(controllerDeps(ctx, o), o.controller ?? {});
  return { status: 'done', ...result };
}

/** Entry point for `npm run agent -- controller`. */
export function main(options?: RunOptions & { exec?: ExecFn }) {
  return runAgent(
    'controller',
    BUDGET,
    (ctx) =>
      controller(ctx, {
        ...(options?.fetch ? { fetch: options.fetch as unknown as FetchLike } : {}),
        ...(options?.exec ? { exec: options.exec } : {}),
      }),
    options,
  );
}
