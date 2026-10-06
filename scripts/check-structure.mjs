#!/usr/bin/env node
// Verifies the repository layout promised in AGENTS.md / docs/ARCHITECTURE.md.
// Runs in CI. Zero dependencies on purpose.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const errors = [];

const requiredFiles = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'LICENSE',
  '.env.example',
  'docs/ARCHITECTURE.md',
  'docs/PROGRESS.md',
  'docs/ROADMAP.md',
  'docs/DECISIONS.md',
  'docs/COSTS.md',
  'docs/RUNBOOK.md',
  'docs/SETUP.md',
  'company/goals.md',
  'data/stamp-duty/schema.json',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/labels.json',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  'data/waitlist-ideas.json',
  'workers/waitlist/wrangler.toml',
  'workers/payment-webhook/wrangler.toml',
  'workers/payment-webhook/migrations/0001_init.sql',
  'workers/download/wrangler.toml',
  'products/catalog.json',
  'products/catalog.schema.json',
  'site/public/_headers',
];

const requiredDirs = [
  'site/src/tools',
  'site/src/content',
  'site/public',
  'tools-core/src',
  'products',
  'data/stamp-duty',
  'workers/payment-webhook',
  'workers/download',
  'agents/lib',
  'company/policies',
  'company/knowledge-base',
  'company/memory',
  'company/ledger',
  'company/reports',
  'legal',
  '.github/ISSUE_TEMPLATE',
];

const agents = [
  'orchestrator',
  'demand-researcher',
  'builder',
  'qa',
  'verifier',
  'seo-listing',
  'social',
  'support',
  'controller',
];

// Every PROCEDURE.md must contain these sections (see prompt §6).
const procedureSections = [
  'Trigger',
  'Inputs',
  'Steps',
  'Output schema',
  'Checklist',
  'Token budget per run',
  'Escalation rule',
];

for (const f of requiredFiles) {
  if (!existsSync(join(root, f))) errors.push(`missing file: ${f}`);
}
for (const d of requiredDirs) {
  const p = join(root, d);
  if (!existsSync(p) || !statSync(p).isDirectory()) errors.push(`missing directory: ${d}`);
}

for (const a of agents) {
  const proc = join(root, 'agents', a, 'PROCEDURE.md');
  if (!existsSync(proc)) {
    errors.push(`missing agents/${a}/PROCEDURE.md`);
    continue;
  }
  const text = readFileSync(proc, 'utf8');
  for (const s of procedureSections) {
    if (!new RegExp(`^##\\s+${s}\\b`, 'mi').test(text)) {
      errors.push(`agents/${a}/PROCEDURE.md: missing "## ${s}" section`);
    }
  }
}

// CLAUDE.md must defer to AGENTS.md so the two never drift.
if (existsSync(join(root, 'CLAUDE.md'))) {
  const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  if (!claude.includes('@AGENTS.md')) errors.push('CLAUDE.md must import @AGENTS.md');
}

// Stamp-duty data files: minimal structural validation (full JSON Schema in schema.json).
const sdDir = join(root, 'data/stamp-duty');
if (existsSync(sdDir)) {
  for (const f of readdirSync(sdDir)) {
    if (!f.endsWith('.json') || f === 'schema.json') continue;
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(sdDir, f), 'utf8'));
    } catch (e) {
      errors.push(`data/stamp-duty/${f}: invalid JSON (${e.message})`);
      continue;
    }
    for (const key of [
      'state',
      'state_code',
      'status',
      'sources',
      'last_verified',
      'verified_by',
      'rates',
    ]) {
      if (!(key in doc)) errors.push(`data/stamp-duty/${f}: missing "${key}"`);
    }
    if (!Array.isArray(doc.sources) || doc.sources.length === 0) {
      errors.push(`data/stamp-duty/${f}: "sources" must be a non-empty array`);
    } else {
      for (const s of doc.sources) {
        if (typeof s?.url !== 'string' || !s.url.startsWith('https://')) {
          errors.push(`data/stamp-duty/${f}: every source needs an https "url"`);
        }
      }
    }
    // Bilingual rule: every rule description and surcharge name needs Hindi text.
    for (const rule of Array.isArray(doc.rates) ? doc.rates : []) {
      if (typeof rule?.description_hi !== 'string' || !rule.description_hi.trim()) {
        errors.push(`data/stamp-duty/${f}: rule "${rule?.id}" needs "description_hi"`);
      }
      for (const sc of Array.isArray(rule?.surcharges_percent) ? rule.surcharges_percent : []) {
        if (typeof sc?.name_hi !== 'string' || !sc.name_hi.trim()) {
          errors.push(
            `data/stamp-duty/${f}: surcharge "${sc?.name}" in "${rule?.id}" needs "name_hi"`,
          );
        }
      }
    }
    if (doc.status !== 'draft' && doc.status !== 'verified') {
      errors.push(`data/stamp-duty/${f}: "status" must be "draft" or "verified"`);
    }
    if (doc.status === 'verified') {
      if (Array.isArray(doc.conflicts) && doc.conflicts.length > 0) {
        errors.push(`data/stamp-duty/${f}: resolve and remove "conflicts" before marking verified`);
      }
      if (/not verified/i.test(String(doc.verified_by))) {
        errors.push(`data/stamp-duty/${f}: "verified_by" must name who verified it`);
      }
    }
    if (typeof doc.last_verified !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.last_verified)) {
      errors.push(`data/stamp-duty/${f}: "last_verified" must be YYYY-MM-DD`);
    }
  }
}

if (errors.length > 0) {
  console.error('Structure check failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log('Structure check passed.');
