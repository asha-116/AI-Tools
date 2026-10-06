#!/usr/bin/env node
// Weekly backup (Phase 6), run by .github/workflows/backup.yml:
//   1. D1 `toolshop-orders` → orders.json (payment id, product, amount, email HMAC, timestamps —
//      no personal data; columns are whitelisted below).
//   2. company/ledger + company/memory → company.tar.gz.
//   3. manifest.json with counts and SHA-256 checksums.
// The waitlist database (`toolshop-waitlist`, holds email addresses) is NEVER exported here;
// the owner exports it by hand to their own device (docs/RUNBOOK.md).
//
// Usage: node scripts/backup.mjs [--out backup]
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, ORDERS_D1_ID (all three, or the D1 part is
//      skipped), WRANGLER (default "npx --yes wrangler@4.143.0").
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

export const ORDERS_DB = 'toolshop-orders';
/** Databases that hold personal data and must never be exported by automation. */
export const FORBIDDEN_DATABASES = ['toolshop-waitlist'];
export const ORDER_COLUMNS = [
  'payment_id',
  'product_id',
  'amount_paise',
  'email_hash',
  'event_id',
  'created_at',
];
export const COMPANY_PATHS = ['company/ledger', 'company/memory'];
export const DEFAULT_WRANGLER = 'npx --yes wrangler@4.143.0';

/** @param {string} s */
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Keyset-paginated, column-whitelisted SELECT on `orders`.
 * @param {string | null} after last payment_id of the previous page
 * @param {number} pageSize
 */
export function ordersQuery(after, pageSize) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('pageSize must be ≥ 1');
  const where = after === null ? '' : ` WHERE payment_id > ${sqlString(after)}`;
  return `SELECT ${ORDER_COLUMNS.join(', ')} FROM orders${where} ORDER BY payment_id LIMIT ${pageSize}`;
}

/**
 * Rows from `wrangler d1 execute --json` output: `[{ results: [...], success: true }]`.
 * Tolerates log lines printed around the JSON.
 * @param {string} stdout
 * @returns {Record<string, unknown>[]}
 */
export function parseWranglerJson(stdout) {
  let doc;
  try {
    doc = JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf('[');
    const end = stdout.lastIndexOf(']');
    if (start < 0 || end <= start) throw new Error('wrangler output has no JSON');
    doc = JSON.parse(stdout.slice(start, end + 1));
  }
  const results = Array.isArray(doc) ? doc : [doc];
  const rows = [];
  for (const r of results) {
    if (r?.success === false)
      throw new Error(`D1 query failed: ${JSON.stringify(r).slice(0, 200)}`);
    if (!Array.isArray(r?.results)) throw new Error('wrangler JSON has no "results" array');
    rows.push(...r.results);
  }
  return rows;
}

const EMAIL_LIKE = /[^\s@]+@[^\s@]+/;

/**
 * Keeps only whitelisted columns and refuses anything that looks like an email address,
 * so a future schema change can never leak personal data into a backup.
 * @param {Record<string, unknown>[]} rows
 */
export function sanitizeOrderRows(rows) {
  return rows.map((row, i) => {
    /** @type {Record<string, unknown>} */
    const clean = {};
    for (const c of ORDER_COLUMNS) {
      const v = row[c] ?? null;
      if (typeof v === 'string' && EMAIL_LIKE.test(v)) {
        throw new Error(`row ${i}: column "${c}" looks like an email address — refusing to export`);
      }
      clean[c] = v;
    }
    return clean;
  });
}

/**
 * Exports every order, page by page.
 * @param {{ database: string, runQuery: (sql: string) => Promise<string>, pageSize?: number }} opts
 */
export async function exportOrders({ database, runQuery, pageSize = 1000 }) {
  if (FORBIDDEN_DATABASES.includes(database)) {
    throw new Error(`${database} holds personal data and is never exported by automation`);
  }
  /** @type {Record<string, unknown>[]} */
  const all = [];
  /** @type {string | null} */
  let after = null;
  for (let page = 0; page < 10000; page++) {
    const rows = sanitizeOrderRows(parseWranglerJson(await runQuery(ordersQuery(after, pageSize))));
    all.push(...rows);
    if (rows.length < pageSize) return all;
    const last = rows[rows.length - 1].payment_id;
    if (typeof last !== 'string' || (after !== null && last <= after)) {
      throw new Error('pagination did not advance');
    }
    after = last;
  }
  throw new Error('too many pages');
}

/**
 * Minimal wrangler config pointing at the orders database (keeps the repo's files untouched).
 * @param {string} databaseId
 */
export function wranglerConfig(databaseId) {
  if (!/^[0-9a-f-]{36}$/i.test(databaseId)) throw new Error('ORDERS_D1_ID must be a UUID');
  return [
    'name = "toolshop-backup"',
    'compatibility_date = "2026-09-01"',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = "${ORDERS_DB}"`,
    `database_id = "${databaseId}"`,
    '',
  ].join('\n');
}

/** @param {Record<string, string | undefined>} env */
export function missingCloudflare(env) {
  return ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'ORDERS_D1_ID'].filter((k) => !env[k]);
}

/** @param {Buffer | string} data */
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/* c8 ignore start — process wiring (wrangler, tar); the pieces above are unit-tested */
const exec = promisify(execFile);

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'backup' } } });
  const root = new URL('..', import.meta.url).pathname;
  const out = values.out;
  await mkdir(out, { recursive: true });
  const env = process.env;
  /** @type {Record<string, unknown>} */
  const manifest = {
    created_at: new Date().toISOString(),
    commit: env.GITHUB_SHA ?? null,
    not_included: 'toolshop-waitlist (personal data; manual export only, see docs/RUNBOOK.md)',
  };

  const missing = missingCloudflare(env);
  if (missing.length) {
    console.log(`::notice::Skipping D1 orders export; not configured: ${missing.join(' ')}`);
    manifest.orders = { status: 'skipped', reason: `not configured: ${missing.join(' ')}` };
  } else {
    const tmp = await mkdtemp(join(tmpdir(), 'backup-'));
    try {
      const config = join(tmp, 'wrangler.toml');
      await writeFile(config, wranglerConfig(String(env.ORDERS_D1_ID)));
      const [cmd, ...pre] = (env.WRANGLER || DEFAULT_WRANGLER).split(/\s+/).filter(Boolean);
      const rows = await exportOrders({
        database: ORDERS_DB,
        runQuery: async (sql) =>
          (
            await exec(
              cmd,
              [
                ...pre,
                'd1',
                'execute',
                ORDERS_DB,
                '--remote',
                '--json',
                '--config',
                config,
                '--command',
                sql,
              ],
              { maxBuffer: 64 * 1024 * 1024, cwd: tmp },
            )
          ).stdout,
      });
      const json =
        JSON.stringify({ table: 'orders', columns: ORDER_COLUMNS, rows }, null, 2) + '\n';
      await writeFile(join(out, 'orders.json'), json);
      manifest.orders = {
        status: 'exported',
        file: 'orders.json',
        rows: rows.length,
        sha256: sha256(json),
      };
      console.log(`Exported ${rows.length} orders`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  const paths = COMPANY_PATHS.filter((p) => existsSync(join(root, p)));
  const tarFile = join(out, 'company.tar.gz');
  await exec('tar', ['-czf', tarFile, '-C', root, ...paths]);
  manifest.company = { file: 'company.tar.gz', paths, sha256: sha256(await readFile(tarFile)) };
  console.log(`Archived ${paths.join(', ')}`);

  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
/* c8 ignore stop */
