// Shared test helpers (not a test file).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Candidate } from '../schema.js';

export function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    title: 'Add Hindi FAQ to the EMI page',
    agent: 'builder',
    type: 'content',
    goal: 'Collect 50 waitlist sign-ups',
    acceptance: ['FAQ renders in EN and HI'],
    inputs: ['site/src/tools/emi/'],
    token_budget: 8000,
    priority: 'normal',
    impact: 3,
    effort: 3,
    needs_owner: false,
    ...over,
  };
}

/** A throwaway repo root holding `files` (repo-relative path → contents). */
export function tempRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'orch-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}
