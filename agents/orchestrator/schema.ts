// zod schemas for the Orchestrator. `OutputSchema` mirrors PROCEDURE.md "Output schema";
// `DraftSchema` is what the LLM returns in step 2 (candidates carry impact/effort for ranking).

import { z } from 'zod';

/**
 * Who an Orchestrator Issue can go to. Only the Builder reads Issues (calculator, formula and
 * template work); the other agents run on their own schedules and never pick up an Issue, so
 * everything else goes to `engineer` — a human or coding session working the Issue queue.
 */
export const TASK_AGENTS = ['builder', 'engineer'] as const;

/** Issue types the Builder can do (tests-first, from cited worked examples). */
export const BUILDER_TYPES = ['tool', 'product'] as const;

export const TASK_TYPES = ['tool', 'product', 'content', 'data', 'infra', 'idea'] as const;
export const PRIORITIES = ['high', 'normal', 'low'] as const;

/** Upper bound for one Issue's token budget (an agent's per-run budget is ≤ 20k). */
export const MAX_TASK_TOKENS = 20_000;
export const MAX_ISSUES = 5;

const text = (max: number) => z.string().trim().min(1).max(max);

export const IssueSchema = z.object({
  title: text(80),
  agent: z.enum(TASK_AGENTS),
  type: z.enum(TASK_TYPES),
  goal: text(300),
  acceptance: z.array(text(300)).min(1).max(8),
  inputs: z.array(text(300)).max(8),
  token_budget: z.number().int().min(0).max(MAX_TASK_TOKENS),
  priority: z.enum(PRIORITIES),
});
export type TaskIssue = z.infer<typeof IssueSchema>;

/** PROCEDURE.md output: the day's Issues (0–5) and the report. */
export const OutputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  issues: z.array(IssueSchema).max(MAX_ISSUES),
  report_markdown: z.string().min(1),
});
export type OrchestratorOutput = z.infer<typeof OutputSchema>;

/** One LLM-drafted candidate: an Issue plus ranking inputs and an owner-approval flag. */
export const CandidateSchema = IssueSchema.extend({
  /** 1 (little) – 5 (moves a current goal directly). */
  impact: z.number().int().min(1).max(5),
  /** 1 (under an hour of agent work) – 5 (several runs). */
  effort: z.number().int().min(1).max(5),
  /** True when the task touches money, legal text, pricing or public claims. */
  needs_owner: z.boolean().default(false),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** Step 2 LLM reply. */
export const DraftSchema = z.object({
  candidates: z.array(CandidateSchema).max(8),
});
export type Draft = z.infer<typeof DraftSchema>;
