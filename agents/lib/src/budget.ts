// Token budgets from each PROCEDURE.md ("Token budget per run"). Hard stop, never a paid model.

import { existsSync, readFileSync } from 'node:fs';
import { BudgetExceeded } from './errors.js';

export interface Usage {
  prompt: number;
  completion: number;
}

export interface BudgetLimits {
  /** Max tokens (prompt + completion) in one run. */
  perRun: number;
  /** Max tokens per UTC day across runs. Defaults to perRun. */
  daily?: number;
}

export class Budget {
  readonly perRun: number;
  readonly daily: number;
  private runUsed = 0;

  constructor(
    readonly agent: string,
    limits: number | BudgetLimits,
    /** Tokens already used today by earlier runs (see tokensUsedInLog). */
    readonly usedBeforeRun = 0,
  ) {
    const l = typeof limits === 'number' ? { perRun: limits } : limits;
    if (!(l.perRun >= 0)) throw new RangeError('budget perRun must be ≥ 0');
    this.perRun = l.perRun;
    this.daily = l.daily ?? l.perRun;
  }

  /** Tokens used in this run. */
  get used(): number {
    return this.runUsed;
  }

  /** Tokens still allowed in this run (respecting the daily cap). Never negative. */
  get remaining(): number {
    const run = this.perRun - this.runUsed;
    const day = this.daily - this.usedBeforeRun - this.runUsed;
    return Math.max(0, Math.min(run, day));
  }

  /** Throws BudgetExceeded if nothing is left. Called before every LLM request. */
  assertAvailable(): void {
    this.check(0);
  }

  /** Record usage; throws BudgetExceeded once a limit is passed. */
  charge(usage: Usage): void {
    const tokens = Math.max(0, usage.prompt) + Math.max(0, usage.completion);
    this.runUsed += tokens;
    this.check(-1);
  }

  // slack 0: "is anything left" (used ≥ limit fails); slack -1: "was it passed" (used > limit fails).
  private check(slack: 0 | -1): void {
    const total = this.usedBeforeRun + this.runUsed;
    if (this.runUsed + slack >= this.perRun) {
      throw new BudgetExceeded(this.agent, 'run', this.perRun, this.runUsed);
    }
    if (total + slack >= this.daily) {
      throw new BudgetExceeded(this.agent, 'daily', this.daily, total);
    }
  }
}

/** Sum `tokens` of every `run.end` line in an agent's JSONL log for the day (0 if none). */
export function tokensUsedInLog(path: string): number {
  if (!existsSync(path)) return 0;
  let sum = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as { event?: unknown; tokens?: unknown };
      if (rec.event === 'run.end' && typeof rec.tokens === 'number') sum += rec.tokens;
    } catch {
      // a torn line from a crashed run: ignore
    }
  }
  return sum;
}
