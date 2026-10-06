/**
 * The Controller pipeline (agents/controller/PROCEDURE.md steps 1–3, 5–6). Deterministic, no LLM.
 * All IO is injected through ControllerDeps so the run is fully testable and the agents/lib
 * runner only has to adapt its clock, fetch, file system, D1 export and GitHub client.
 *
 * Not covered here: step 4 (usage vs free-tier limits → docs/COSTS.md).
 */

import { parseCatalog } from '../../../workers/lib/src/catalog.js';
import {
  costsTable,
  mergeTable,
  readTable,
  refundRow,
  refundsTable,
  saleFromPayment,
  salesTable,
  settlementRow,
  settlementsTable,
  type SaleRow,
} from './ledger.js';
import { formatInr } from './money.js';
import { assertNoPii } from './pii.js';
import { computeWeeklyPnl, renderWeeklyPnl, upsertPnlSection } from './pnl.js';
import { razorpayClientFromEnv, type FetchLike, type RazorpayPayment } from './razorpay.js';
import {
  parseD1Orders,
  reconcileOrders,
  reconcileSettlements,
  rejectedToMismatch,
  type Mismatch,
} from './reconcile.js';
import {
  addDays,
  istDate,
  istDateOfIso,
  istDayWindow,
  isoWeekOf,
  isoWeekRange,
  weekday,
} from './time.js';

export interface GithubIssue {
  title: string;
  body: string;
  labels: string[];
}

export interface GithubPullRequest {
  branch: string;
  title: string;
  body: string;
  /** Repo-relative paths written this run (already written via `writeFile`). */
  paths: string[];
  labels: string[];
}

/** Everything the Controller touches outside its own memory. */
export interface ControllerDeps {
  now(): Date;
  fetch: FetchLike;
  /** Needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET; optional ALLOW_DRAFT_PRODUCTS=true. */
  env: Readonly<Record<string, string | undefined>>;
  /** Repo-relative path → contents, or null if the file does not exist. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, contents: string): Promise<void>;
  /** Parsed JSON printed by `wrangler d1 execute toolshop-orders --remote --json --command …`. */
  readD1Orders(): Promise<unknown>;
  github: {
    createIssue(issue: GithubIssue): Promise<void>;
    openPullRequest(pr: GithubPullRequest): Promise<void>;
  };
  /** Structured log line (no secrets, no PII). */
  log(event: string, data?: Record<string, unknown>): void;
}

export interface ControllerOptions {
  /** IST business day to pull. Default: yesterday in IST. */
  day?: string;
  /**
   * Write the P&L for the ISO week containing `day`, and reconcile the settlements of the week
   * before it (so settlements arriving `settlementLagDays` later are already in the ledger).
   * Default: today (IST) is Monday.
   */
  weekly?: boolean;
  /**
   * Days between the end of a payment week and the settlements that pay it out. Razorpay's
   * default cycle is T+2 working days (to be confirmed per account). Default 2.
   */
  settlementLagDays?: number;
  /** See SaleOptions.feeIncludesTax. Default true. */
  feeIncludesTax?: boolean;
}

export interface ControllerResult {
  day: string;
  week: string | null;
  added: { sales: number; refunds: number; settlements: number };
  mismatches: Mismatch[];
  written: string[];
}

export const CATALOG_PATH = 'products/catalog.json';
export const SQL_EXPORT = 'SELECT payment_id, product_id, amount_paise, created_at FROM orders';

export async function runController(
  deps: ControllerDeps,
  opts: ControllerOptions = {},
): Promise<ControllerResult> {
  const today = istDate(Math.floor(deps.now().getTime() / 1000));
  const day = opts.day ?? addDays(today, -1);
  const weekly = opts.weekly ?? weekday(today) === 0;
  const lag = opts.settlementLagDays ?? 2;
  const saleOpts = {
    allowDrafts: deps.env['ALLOW_DRAFT_PRODUCTS'] === 'true',
    feeIncludesTax: opts.feeIncludesTax ?? true,
  };
  deps.log('controller_start', { day, weekly });

  const catalogText = await deps.readFile(CATALOG_PATH);
  if (catalogText === null) throw new Error(`${CATALOG_PATH} not found`);
  const catalog = parseCatalog(JSON.parse(catalogText));
  const rzp = razorpayClientFromEnv(deps.env, deps.fetch);
  const mismatches: Mismatch[] = [];

  // 1. Pull the day's payments, refunds and settlements.
  const { fromUnix, toUnix } = istDayWindow(day);
  const payments = await rzp.listPayments(fromUnix, toUnix);
  const refunds = await rzp.listRefunds(fromUnix, toUnix);
  const settlements = await rzp.listSettlements(fromUnix, toUnix);
  for (const r of [...payments.rejected, ...refunds.rejected, ...settlements.rejected]) {
    mismatches.push(rejectedToMismatch(r));
  }

  // Existing ledger.
  const existing = {
    sales: await deps.readFile(salesTable.file),
    refunds: await deps.readFile(refundsTable.file),
    settlements: await deps.readFile(settlementsTable.file),
    costs: await deps.readFile(costsTable.file),
  };
  const ledgerSales = readTable(salesTable, existing.sales);

  // D1 orders. Orders dated `day` whose payment is not known yet (created just before
  // midnight, or missed on an earlier run) are fetched one by one.
  const d1 = parseD1Orders(await deps.readD1Orders());
  mismatches.push(...d1.invalid);
  const fetched: RazorpayPayment[] = [...payments.items];
  const known = new Set([...ledgerSales.map((s) => s.paymentId), ...fetched.map((p) => p.id)]);
  const otherPayments = new Map<string, string>();
  const reported = new Set<string>();
  for (const o of d1.orders) {
    if (istDateOfIso(o.createdAt) !== day || known.has(o.paymentId)) continue;
    known.add(o.paymentId);
    const p = await rzp.fetchPayment(o.paymentId);
    if (p === null) continue; // reported as order_without_payment below
    if (!p.ok) {
      // Already reported as invalid_record; do not report it again as a missing payment.
      reported.add(o.paymentId);
      mismatches.push(rejectedToMismatch(p.rejected));
      continue;
    }
    fetched.push(p.value);
  }
  for (const p of fetched) otherPayments.set(p.id, p.status);

  // 2. Append to the ledger.
  const newSales = fetched
    .map((p) => saleFromPayment(p, catalog, saleOpts))
    .filter((s): s is SaleRow => s !== null);
  const sales = mergeTable(salesTable, existing.sales, newSales);
  const refundsM = mergeTable(refundsTable, existing.refunds, refunds.items.map(refundRow));
  const settlementsM = mergeTable(
    settlementsTable,
    existing.settlements,
    settlements.items.map(settlementRow),
  );
  const costsM = mergeTable(costsTable, existing.costs, []);

  const written: string[] = [];
  const write = async (path: string, contents: string, before: string | null) => {
    assertNoPii(contents, path);
    if (contents === before) return;
    await deps.writeFile(path, contents);
    written.push(path);
  };
  await write(salesTable.file, sales.csv, existing.sales);
  await write(refundsTable.file, refundsM.csv, existing.refunds);
  await write(settlementsTable.file, settlementsM.csv, existing.settlements);
  // costs.csv is maintained by hand / usage tracking; created with its header on first run.
  await write(costsTable.file, costsM.csv, existing.costs);

  // 3. Reconcile orders for the day.
  mismatches.push(
    ...reconcileOrders({
      sales: sales.rows,
      otherPayments,
      orders: d1.orders.filter((o) => !reported.has(o.paymentId)),
      range: { from: day, to: day },
    }),
  );

  // 5. Weekly: P&L for the week containing `day`. Settlements are checked one week further
  // back, so that settlements arriving `lag` days after that week are already in the ledger.
  let week: string | null = null;
  if (weekly) {
    week = isoWeekOf(day);
    const range = isoWeekRange(week);
    const pnl = computeWeeklyPnl({
      week,
      sales: sales.rows,
      refunds: refundsM.rows,
      costs: costsM.rows,
    });
    const path = `company/reports/weekly/${week}.md`;
    const before = await deps.readFile(path);
    await write(path, upsertPnlSection(before, renderWeeklyPnl(pnl), week), before);

    const from = addDays(range.startDate, -7);
    const to = addDays(range.endDate, -7);
    const settled = reconcileSettlements({
      sales: sales.rows,
      refunds: refundsM.rows,
      settlements: settlementsM.rows,
      paymentRange: { from, to },
      settlementRange: { from: addDays(from, lag), to: addDays(to, lag) },
    });
    if (settled.mismatch) mismatches.push(settled.mismatch);
  }

  // Mismatches → one type:bug Issue (IDs and amounts only).
  if (mismatches.length > 0) {
    await deps.github.createIssue({
      title: `Controller: ${String(mismatches.length)} reconciliation mismatch(es) for ${day}`,
      body: renderMismatches(day, mismatches),
      labels: ['type:bug', 'agent:controller'],
    });
  }

  // 6. PR with the ledger/report changes.
  if (written.length > 0) {
    await deps.github.openPullRequest({
      branch: `agent/controller/${day}`,
      title: `chore: ledger for ${day}${week ? ` and P&L ${week}` : ''}`,
      body: [
        `Controller run for business day ${day} (IST).`,
        '',
        `- sales added: ${String(sales.added.length)}`,
        `- refunds added: ${String(refundsM.added.length)}`,
        `- settlements added: ${String(settlementsM.added.length)}`,
        `- reconciliation mismatches: ${String(mismatches.length)}`,
        '',
        'Files: ' + written.map((p) => `\`${p}\``).join(', '),
      ].join('\n'),
      paths: written,
      labels: ['agent:controller'],
    });
  }

  const result: ControllerResult = {
    day,
    week,
    added: {
      sales: sales.added.length,
      refunds: refundsM.added.length,
      settlements: settlementsM.added.length,
    },
    mismatches,
    written,
  };
  deps.log('controller_done', {
    day,
    week,
    ...result.added,
    mismatches: mismatches.length,
    written: written.length,
  });
  return result;
}

export function renderMismatches(day: string, mismatches: readonly Mismatch[]): string {
  const money = (p: number | undefined) => (p === undefined ? '' : formatInr(p));
  const body = [
    `Reconciliation for business day ${day} (IST) found ${String(mismatches.length)} mismatch(es).`,
    'Tolerance is ₹0.00. IDs only — look buyers up in the Razorpay dashboard, not here.',
    '',
    '| Type | IDs | Expected | Actual | Detail |',
    '| --- | --- | ---: | ---: | --- |',
    ...mismatches.map(
      (m) =>
        `| ${m.type} | ${m.ids.join(' ')} | ${money(m.expectedPaise)} | ${money(m.actualPaise)} | ${m.detail.replace(/\|/g, '/')} |`,
    ),
    '',
    'Escalate with `needs-owner` if a mismatch persists for 2 days (PROCEDURE.md).',
  ].join('\n');
  assertNoPii(body, 'mismatch issue');
  return body;
}

// `npm run agent -- controller` loads this module and calls main() (wiring in main.ts).
export { main } from './main.js';
