/**
 * Business-day and ISO-week helpers.
 *
 * Razorpay timestamps are unix seconds (UTC). The business runs on India Standard Time
 * (UTC+05:30, no daylight saving), so a payment at 2026-12-31T19:00:00Z belongs to the
 * business day 2027-01-01. Every date in the ledger is an IST calendar date (YYYY-MM-DD).
 */

export const IST_OFFSET_SECONDS = 5 * 3600 + 30 * 60;
const DAY_SECONDS = 86_400;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;

/** Half-open interval [fromUnix, toUnix) in unix seconds. */
export interface UnixWindow {
  fromUnix: number;
  toUnix: number;
}

/** Parses a YYYY-MM-DD date and returns midnight UTC of it in unix seconds. */
function utcMidnight(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`bad date: ${date}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Rejects 2026-02-30 and similar, which Date.UTC would silently roll over.
  if (new Date(ms).toISOString().slice(0, 10) !== date) throw new Error(`bad date: ${date}`);
  return ms / 1000;
}

export function isValidDate(date: string): boolean {
  try {
    utcMidnight(date);
    return true;
  } catch {
    return false;
  }
}

/** IST calendar date of a unix timestamp. */
export function istDate(unix: number): string {
  return new Date((unix + IST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
}

/** IST calendar date of an ISO-8601 instant (e.g. D1 `created_at`), or null if unparseable. */
export function istDateOfIso(iso: string): string | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : istDate(Math.floor(ms / 1000));
}

export function addDays(date: string, days: number): string {
  return new Date((utcMidnight(date) + days * DAY_SECONDS) * 1000).toISOString().slice(0, 10);
}

/** The IST business day as unix seconds: [00:00 IST, next 00:00 IST). */
export function istDayWindow(date: string): UnixWindow {
  const fromUnix = utcMidnight(date) - IST_OFFSET_SECONDS;
  return { fromUnix, toUnix: fromUnix + DAY_SECONDS };
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(date: string): number {
  return (new Date(utcMidnight(date) * 1000).getUTCDay() + 6) % 7;
}

/** ISO-8601 week (`YYYY-Www`) of a calendar date. The week belongs to the year of its Thursday. */
export function isoWeekOf(date: string): string {
  const thursday = addDays(date, 3 - weekday(date));
  const year = thursday.slice(0, 4);
  const days = (utcMidnight(thursday) - utcMidnight(`${year}-01-01`)) / DAY_SECONDS;
  const week = 1 + Math.floor(days / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export interface WeekRange extends UnixWindow {
  week: string;
  /** Monday, IST date. */
  startDate: string;
  /** Sunday, IST date (inclusive). */
  endDate: string;
}

/** Monday–Sunday of an ISO week, plus its IST unix window. */
export function isoWeekRange(week: string): WeekRange {
  const m = WEEK_RE.exec(week);
  if (!m) throw new Error(`bad ISO week: ${week}`);
  const jan4 = `${m[1] ?? ''}-01-04`;
  const week1Monday = addDays(jan4, -weekday(jan4));
  const startDate = addDays(week1Monday, (Number(m[2]) - 1) * 7);
  if (isoWeekOf(startDate) !== week) throw new Error(`bad ISO week: ${week}`);
  const endDate = addDays(startDate, 6);
  return {
    week,
    startDate,
    endDate,
    fromUnix: istDayWindow(startDate).fromUnix,
    toUnix: istDayWindow(endDate).toUnix,
  };
}
