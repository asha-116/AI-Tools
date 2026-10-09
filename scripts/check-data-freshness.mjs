#!/usr/bin/env node
// Rates are data with a `last_verified` date (AGENTS.md rule 6). This check keeps those dates
// honest: a rate the site shows as verified must have been re-checked within 180 days.
//
// - error:   a `last_verified` that is not a real YYYY-MM-DD date, or lies in the future
// - error:   a file with status "verified" older than 180 days (the site serves it to users)
// - warning: a draft older than 180 days, or any file due within 30 days
//
// The Orchestrator opens a "Re-verify …" Issue at the same 180 days (STALE_DATA_DAYS).
// Usage: node scripts/check-data-freshness.mjs [--today YYYY-MM-DD]
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_AGE_DAYS = 180;
export const WARN_BEFORE_DAYS = 30;

/**
 * Every `last_verified` string anywhere in a parsed JSON document.
 * @param {unknown} doc
 * @returns {string[]}
 */
export function lastVerifiedDates(doc, depth = 0) {
  if (depth > 20 || doc === null || typeof doc !== 'object') return [];
  /** @type {string[]} */
  const out = [];
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'last_verified' && typeof v === 'string') out.push(v);
    else out.push(...lastVerifiedDates(v, depth + 1));
  }
  return out;
}

/**
 * Whole days from a YYYY-MM-DD date to `today`, or null when it is not a real calendar date.
 * @param {string} date
 * @param {string} today
 */
export function ageInDays(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) return null;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - t) / 86_400_000);
}

/**
 * @typedef {{ path: string, doc: unknown }} DataDoc
 * @typedef {{ level: 'error' | 'warning', path: string, message: string }} Finding
 */

/**
 * @param {DataDoc[]} docs
 * @param {string} today YYYY-MM-DD
 * @returns {Finding[]}
 */
export function checkFreshness(docs, today) {
  /** @type {Finding[]} */
  const out = [];
  for (const { path, doc } of docs) {
    const dates = lastVerifiedDates(doc);
    if (dates.length === 0) continue;
    const ages = [];
    for (const d of dates) {
      const age = ageInDays(d, today);
      if (age === null) {
        out.push({
          level: 'error',
          path,
          message: `"last_verified" ${d} is not a YYYY-MM-DD date`,
        });
      } else if (age < 0) {
        out.push({ level: 'error', path, message: `"last_verified" ${d} is in the future` });
      } else {
        ages.push(age);
      }
    }
    if (ages.length === 0) continue;
    const oldest = Math.max(...ages);
    const verified =
      typeof doc === 'object' && doc !== null && /** @type {any} */ (doc).status === 'verified';
    if (oldest > MAX_AGE_DAYS) {
      out.push({
        level: verified ? 'error' : 'warning',
        path,
        message: verified
          ? `verified ${oldest} days ago (limit ${MAX_AGE_DAYS}): re-verify the rates against the sources, or set "status": "draft" so the site stops showing them`
          : `draft not re-verified for ${oldest} days`,
      });
    } else if (oldest > MAX_AGE_DAYS - WARN_BEFORE_DAYS) {
      out.push({
        level: 'warning',
        path,
        message: `re-verify within ${MAX_AGE_DAYS - oldest} days (last verified ${oldest} days ago)`,
      });
    }
  }
  return out;
}

/**
 * Every data/**\/*.json except JSON Schema files.
 * @param {string} root
 * @returns {DataDoc[]}
 */
export function readDataDocs(root) {
  /** @type {DataDoc[]} */
  const out = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json') && e.name !== 'schema.json') {
        out.push({ path: relative(root, full), doc: JSON.parse(readFileSync(full, 'utf8')) });
      }
    }
  };
  walk(join(root, 'data'));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** @param {string[]} argv */
function main(argv) {
  const i = argv.indexOf('--today');
  const today = i >= 0 ? String(argv[i + 1]) : new Date().toISOString().slice(0, 10);
  const findings = checkFreshness(readDataDocs(process.cwd()), today);
  const annotate = process.env.GITHUB_ACTIONS === 'true';
  for (const f of findings) {
    console.log(
      annotate
        ? `::${f.level} file=${f.path}::${f.message}`
        : `${f.level}: ${f.path}: ${f.message}`,
    );
  }
  const errors = findings.filter((f) => f.level === 'error').length;
  if (errors > 0) {
    console.error(`Data freshness check failed (${errors} error${errors === 1 ? '' : 's'}).`);
    process.exit(1);
  }
  console.log('Data freshness check passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
