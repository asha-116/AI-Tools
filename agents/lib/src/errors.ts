// Typed errors that runAgent() understands. Agents throw these; they never catch them.

/** The per-run or daily token budget is used up. The run stops; it never switches to a paid model. */
export class BudgetExceeded extends Error {
  override readonly name = 'BudgetExceeded';
  constructor(
    readonly agent: string,
    readonly scope: 'run' | 'daily',
    readonly limit: number,
    readonly used: number,
  ) {
    super(`${agent}: ${scope} token budget exceeded (${used} / ${limit})`);
  }
}

/** What the owner needs to decide. Text is redacted before it is written to an Issue. */
export interface EscalationRequest {
  /** Short Issue title (≤ 80 chars is best). */
  title: string;
  /** What happened and why the agent cannot continue. */
  context: string;
  /** The choices the owner has. */
  options: string[];
  /** Which option the agent recommends, and why. */
  recommendation: string;
  /** Dedupe key; the same key never opens a second open Issue. Defaults to a slug of the title. */
  key?: string;
}

/** Stop and ask the owner. runAgent() turns this into a deduplicated `needs-owner` Issue. */
export class Escalation extends Error {
  override readonly name = 'Escalation';
  constructor(
    readonly request: EscalationRequest,
    options?: { cause?: unknown },
  ) {
    super(request.title, options);
  }
}

/** Every configured provider failed or none has a key. */
export class LlmUnavailable extends Error {
  override readonly name = 'LlmUnavailable';
  constructor(
    /** One entry per provider tried: id and the last HTTP status (0 = network error). Never bodies. */
    readonly attempts: { provider: string; status: number; reason: string }[],
  ) {
    super(
      attempts.length === 0
        ? 'no LLM provider available (no API keys set, or all excluded)'
        : `all LLM providers failed: ${attempts.map((a) => `${a.provider}=${a.reason}`).join(', ')}`,
    );
  }
}

/** A GitHub REST call returned a non-2xx status. The message never contains the token. */
export class GitHubError extends Error {
  override readonly name = 'GitHubError';
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    detail: string,
  ) {
    super(`GitHub ${method} ${path} → ${status}${detail ? `: ${detail}` : ''}`);
  }
}
