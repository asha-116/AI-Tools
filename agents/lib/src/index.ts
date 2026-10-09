// Public API of the shared agent runtime. Agents import from here (tests also from ./testing.js).

export { Budget, tokensUsedInLog, type BudgetLimits, type Usage } from './budget.js';
export {
  isDryRun,
  loadConfig,
  parseRepository,
  secretValues,
  type AgentConfig,
  type Env,
} from './config.js';
export {
  BudgetExceeded,
  Escalation,
  GitHubError,
  LlmUnavailable,
  type EscalationRequest,
} from './errors.js';
export { escalate, escalationBody, escalationKey, escalationMarker } from './escalate.js';
export {
  GitHub,
  assertAgentBranch,
  commentMarker,
  type CommitStatus,
  type FileChange,
  type GitHubClient,
  type GitHubOptions,
  type IssueSummary,
  type OpenPullRequest,
  type PullSummary,
  type WriteResult,
} from './github.js';
export {
  availableProviders,
  backoffMs,
  createLlm,
  loadProviders,
  ProviderSchema,
  type ChatMessage,
  type LlmClient,
  type LlmOptions,
  type LlmRequest,
  type LlmResponse,
  type Provider,
} from './llm.js';
export {
  createLogger,
  defaultLogDir,
  logPath,
  scrub,
  scrubString,
  type LogData,
  type Logger,
  type LoggerOptions,
  type LogLevel,
} from './log.js';
export { promptSections, readAgentFile, renderTemplate } from './prompt.js';
export {
  containsPii,
  findCuedNames,
  redact,
  restore,
  type PiiKind,
  type RedactionMap,
  type RedactOptions,
  type RedactResult,
} from './redact.js';
export {
  DEFAULT_REPOSITORY,
  exitCode,
  runAgent,
  type AgentContext,
  type RunOptions,
  type RunResult,
  type RunStatus,
} from './run.js';
export { chatJson, parseJsonLoose, validateWithRetry } from './schema.js';
export { formatFiles, prettierFormatter, type Formatter } from './format.js';
