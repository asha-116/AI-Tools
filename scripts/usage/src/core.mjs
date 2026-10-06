// Pure core of the free-tier usage monitor (Phase 6): limits validation, period maths,
// percentage/threshold evaluation and Markdown output. No I/O here.

/**
 * @typedef {{ id: string, service: string, metric: string, unit: string,
 *   window: 'day' | 'month', limit: number, source: string, last_verified: string,
 *   applies_to?: string }} Limit
 * @typedef {{ threshold: number, limits: Limit[], runnerMultipliers: Record<string, number>,
 *   r2Classes: { a: string[], b: string[] } }} LimitsConfig
 * @typedef {{ month: string, start: string, end: string, startTime: string, endTime: string,
 *   partial: boolean }} Period
 * @typedef {{ id: string, value?: number, peakDate?: string, detail?: string,
 *   unlimited?: string, error?: string }} Measurement
 * @typedef {'ok' | 'alert' | 'error' | 'not-collected' | 'unlimited'} Status
 * @typedef {Limit & { used: number | null, percent: number | null, status: Status,
 *   detail: string }} Row
 * @typedef {{ agent: string, calls: number, prompt: number, completion: number }} LlmAgentTotal
 * @typedef {{ agents: LlmAgentTotal[], files: number, undated: number, malformed: number }} LlmSummary
 */

export const USAGE_ALERT_KEY = 'free-tier-usage';
export const ALERT_LABELS = ['needs-owner', 'type:infra', 'type:alert'];

/**
 * Validates data/free-tier-limits.json and returns the parts the monitor uses.
 * @param {any} doc
 * @returns {LimitsConfig}
 */
export function parseLimits(doc) {
  const errors = [];
  const threshold = doc?.alert_threshold_percent;
  if (typeof threshold !== 'number' || threshold <= 0 || threshold > 100) {
    errors.push('alert_threshold_percent must be a number in (0, 100]');
  }
  const limits = Array.isArray(doc?.limits) ? doc.limits : [];
  if (limits.length === 0) errors.push('limits must be a non-empty array');
  const ids = new Set();
  for (const l of limits) {
    const where = `limit "${l?.id}"`;
    if (typeof l?.id !== 'string' || !l.id) errors.push('every limit needs an "id"');
    else if (ids.has(l.id)) errors.push(`${where}: duplicate id`);
    else ids.add(l.id);
    for (const k of ['service', 'metric', 'unit']) {
      if (typeof l?.[k] !== 'string' || !l[k]) errors.push(`${where}: missing "${k}"`);
    }
    if (l?.window !== 'day' && l?.window !== 'month') {
      errors.push(`${where}: "window" must be "day" or "month"`);
    }
    if (typeof l?.limit !== 'number' || !(l.limit > 0)) {
      errors.push(`${where}: "limit" must be a positive number`);
    }
    if (typeof l?.source !== 'string' || !l.source.startsWith('https://')) {
      errors.push(`${where}: "source" must be an https URL`);
    }
    if (typeof l?.last_verified !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(l.last_verified)) {
      errors.push(`${where}: "last_verified" must be YYYY-MM-DD`);
    }
  }
  const mult = doc?.github_runner_multipliers ?? {};
  const runnerMultipliers = {};
  for (const os of ['linux', 'windows', 'macos']) {
    if (typeof mult[os] !== 'number' || mult[os] <= 0) {
      errors.push(`github_runner_multipliers.${os} must be a positive number`);
    } else runnerMultipliers[os] = mult[os];
  }
  const cls = doc?.r2_operation_classes ?? {};
  if (!Array.isArray(cls.class_a) || !Array.isArray(cls.class_b)) {
    errors.push('r2_operation_classes needs "class_a" and "class_b" arrays');
  }
  if (errors.length) throw new Error(`Invalid free-tier limits:\n- ${errors.join('\n- ')}`);
  return {
    threshold,
    limits,
    runnerMultipliers,
    r2Classes: { a: [...cls.class_a], b: [...cls.class_b] },
  };
}

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * Report period. `arg` is "previous" (default: last full calendar month, for the report on
 * the 1st), "current" (month to date) or an explicit "YYYY-MM". All dates are UTC.
 * @param {string | undefined} arg
 * @param {Date} now
 * @returns {Period}
 */
export function resolvePeriod(arg, now) {
  const value = (arg ?? '').trim() || 'previous';
  let y;
  let m; // 1-based
  if (value === 'previous') {
    y = now.getUTCFullYear();
    m = now.getUTCMonth(); // previous month, 1-based
    if (m === 0) {
      y -= 1;
      m = 12;
    }
  } else if (value === 'current') {
    y = now.getUTCFullYear();
    m = now.getUTCMonth() + 1;
  } else {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
      throw new Error(`month must be "previous", "current" or YYYY-MM, got "${value}"`);
    }
    y = Number(match[1]);
    m = Number(match[2]);
  }
  const month = `${y}-${pad(m)}`;
  const nowMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  if (month > nowMonth) throw new Error(`month ${month} is in the future`);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const partial = month === nowMonth;
  const endDay = partial ? now.getUTCDate() : lastDay;
  const start = `${month}-01`;
  const end = `${month}-${pad(endDay)}`;
  return {
    month,
    start,
    end,
    startTime: `${start}T00:00:00Z`,
    endTime: partial ? now.toISOString().replace(/\.\d{3}Z$/, 'Z') : `${end}T23:59:59Z`,
    partial,
  };
}

/**
 * Billed minutes of one Actions job: whole minutes rounded up, times the runner multiplier.
 * Skipped/never-started jobs cost nothing.
 * @param {{ started_at?: string | null, completed_at?: string | null, conclusion?: string | null,
 *   labels?: string[] }} job
 * @param {Record<string, number>} multipliers
 */
export function jobBilledMinutes(job, multipliers) {
  if (!job.started_at || !job.completed_at || job.conclusion === 'skipped') return 0;
  const ms = Date.parse(job.completed_at) - Date.parse(job.started_at);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const labels = (job.labels ?? []).join(' ').toLowerCase();
  const os = labels.includes('macos') ? 'macos' : labels.includes('windows') ? 'windows' : 'linux';
  return Math.ceil(ms / 60000) * (multipliers[os] ?? 1);
}

/**
 * Peak day of a daily series: sums values per date, returns the biggest day.
 * @param {{ date: string, value: number }[]} points
 * @returns {{ value: number, date?: string, days: number }}
 */
export function peakDay(points) {
  /** @type {Map<string, number>} */
  const byDate = new Map();
  for (const p of points) {
    if (!p.date || !Number.isFinite(p.value)) continue;
    byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.value);
  }
  let best = { value: 0, date: /** @type {string | undefined} */ (undefined) };
  for (const [date, value] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    if (value > best.value) best = { value, date };
  }
  return { ...best, days: byDate.size };
}

/** Percentage rounded to one decimal. */
export function percentOf(/** @type {number} */ used, /** @type {number} */ limit) {
  return Math.round((used / limit) * 1000) / 10;
}

/**
 * Joins limits with measurements and flags anything at or above the threshold.
 * @param {LimitsConfig} config
 * @param {Measurement[]} measurements
 * @param {Record<string, string>} [notCollected] limit id → reason (e.g. "not configured")
 * @returns {Row[]}
 */
export function evaluate(config, measurements, notCollected = {}) {
  const byId = new Map(measurements.map((m) => [m.id, m]));
  return config.limits.map((limit) => {
    const m = byId.get(limit.id);
    /** @type {Row} */
    const row = { ...limit, used: null, percent: null, status: 'not-collected', detail: '' };
    if (!m) {
      row.detail = notCollected[limit.id] ?? 'no collector';
      return row;
    }
    if (m.error) return { ...row, status: 'error', detail: m.error };
    const used = typeof m.value === 'number' && Number.isFinite(m.value) ? m.value : 0;
    const detail = [m.peakDate ? `peak day ${m.peakDate}` : '', m.detail ?? '']
      .filter(Boolean)
      .join('; ');
    if (m.unlimited) {
      return {
        ...row,
        used,
        status: 'unlimited',
        detail: [m.unlimited, detail].filter(Boolean).join('; '),
      };
    }
    const percent = percentOf(used, limit.limit);
    return { ...row, used, percent, status: percent >= config.threshold ? 'alert' : 'ok', detail };
  });
}

/** @param {number} n */
export function formatNumber(n) {
  if (!Number.isFinite(n)) return '—';
  const rounded = Number.isInteger(n) ? n : Math.round(n * 1000) / 1000;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** @param {string} s */
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** @param {Status} s */
function statusText(s) {
  return {
    ok: 'ok',
    alert: '**ALERT**',
    error: 'error',
    'not-collected': 'not collected',
    unlimited: 'no limit',
  }[s];
}

/**
 * The monthly Markdown report written to company/reports/usage/<YYYY-MM>.md.
 * @param {{ period: Period, rows: Row[], threshold: number, llm: LlmSummary | null,
 *   llmNote?: string, generatedAt: Date, runUrl?: string }} input
 */
export function formatReport({ period, rows, threshold, llm, llmNote, generatedAt, runUrl }) {
  const alerts = rows.filter((r) => r.status === 'alert');
  const lines = [
    `# Free-tier usage — ${period.month}`,
    '',
    `Period: ${period.start} to ${period.end} (UTC)${period.partial ? ' — **month to date**' : ''}. ` +
      `Generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC by \`scripts/usage\`` +
      (runUrl ? ` ([run](${runUrl}))` : '') +
      '.',
    '',
    alerts.length
      ? `**${alerts.length} limit(s) at or above ${threshold}%:** ${alerts.map((r) => `${r.service} — ${r.metric}`).join('; ')}.`
      : `No limit at or above ${threshold}%.`,
    '',
    '| Service | Metric | Window | Used | Free limit | % used | Status | Notes |',
    '| --- | --- | --- | --: | --: | --: | --- | --- |',
  ];
  for (const r of rows) {
    const window = r.window === 'day' ? 'busiest day' : 'month';
    lines.push(
      `| ${cell(r.service)} | ${cell(r.metric)} | ${window} | ${r.used === null ? '—' : `${formatNumber(r.used)} ${cell(r.unit)}`} | ` +
        `${formatNumber(r.limit)} ${cell(r.unit)} | ${r.percent === null ? '—' : `${r.percent}%`} | ${statusText(r.status)} | ${cell(r.detail)} |`,
    );
  }
  lines.push('', '## Agent LLM tokens', '');
  if (!llm || llm.agents.length === 0) {
    lines.push(llmNote ?? 'No LLM calls logged in this period.');
  } else {
    lines.push(
      '| Agent | Calls | Prompt tokens | Completion tokens | Total |',
      '| --- | --: | --: | --: | --: |',
    );
    const total = { calls: 0, prompt: 0, completion: 0 };
    for (const a of llm.agents) {
      total.calls += a.calls;
      total.prompt += a.prompt;
      total.completion += a.completion;
      lines.push(
        `| ${cell(a.agent)} | ${formatNumber(a.calls)} | ${formatNumber(a.prompt)} | ${formatNumber(a.completion)} | ${formatNumber(a.prompt + a.completion)} |`,
      );
    }
    lines.push(
      `| **Total** | ${formatNumber(total.calls)} | ${formatNumber(total.prompt)} | ${formatNumber(total.completion)} | ${formatNumber(total.prompt + total.completion)} |`,
    );
    lines.push(
      '',
      'Provider free tiers limit requests/tokens per model per minute/day; budgets are enforced by `agents/lib` at run time, so this table is for trend-watching only.',
    );
  }
  if (llm && (llm.undated || llm.malformed)) {
    lines.push(
      '',
      `Skipped log lines: ${llm.undated} without a date, ${llm.malformed} unreadable.`,
    );
  }
  lines.push(
    '',
    '## Sources',
    '',
    'Limits come from `data/free-tier-limits.json` (mirrors `docs/COSTS.md`). Daily limits are compared with the busiest day of the period.',
    '',
  );
  const seen = new Set();
  for (const r of rows) {
    const key = `${r.service}|${r.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${r.service}: <${r.source}> (last verified ${r.last_verified})`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Issue content when anything is at/above the threshold; `null` otherwise.
 * @param {{ period: Period, rows: Row[], threshold: number, reportPath: string, runUrl?: string }} input
 */
export function buildUsageAlert({ period, rows, threshold, reportPath, runUrl }) {
  const alerts = rows.filter((r) => r.status === 'alert');
  if (alerts.length === 0) return null;
  const list = alerts.map(
    (r) =>
      `- **${r.service} — ${r.metric}**: ${formatNumber(/** @type {number} */ (r.used))} of ${formatNumber(r.limit)} ${r.unit} ` +
      `(${r.percent}% of the ${r.window === 'day' ? 'daily' : 'monthly'} free limit${r.detail ? `; ${r.detail}` : ''})`,
  );
  const where = runUrl
    ? `[the run summary](${runUrl}) (artifact \`usage-report\`)`
    : `\`${reportPath}\``;
  const body = [
    `One or more free-tier limits reached ${threshold}% in **${period.month}**${period.partial ? ' (month to date)' : ''}:`,
    '',
    ...list,
    '',
    `Full report: ${where}.`,
    '',
    '### Options (owner decides — AGENTS.md rule 4)',
    '',
    '1. **Reduce** usage (e.g. fewer scheduled agent runs; see `docs/COSTS.md` → Actions minutes budget).',
    '2. **Switch** to another free option (e.g. make the repo public for unlimited Actions minutes, ADR-009).',
    '3. **Pay** — only with an entry in `docs/COSTS.md` and an `approved-by-owner` Issue.',
    '',
    'This Issue is updated each time the monitor runs while it stays open. Close it when handled.',
    '',
    '_Opened automatically by `scripts/usage` (`.github/workflows/usage.yml`)._',
  ].join('\n');
  const comment = [
    `Usage check for ${period.month}${period.partial ? ' (month to date)' : ''}:`,
    '',
    ...list,
  ].join('\n');
  return {
    title: `Free-tier usage at or above ${threshold}%`,
    body,
    comment,
    labels: ALERT_LABELS,
  };
}
