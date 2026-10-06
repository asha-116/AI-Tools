// Environment → typed config. The only module that reads process.env (callers may inject env).

export type Env = Readonly<Record<string, string | undefined>>;

export interface AgentConfig {
  /** True unless DRY_RUN is exactly 'false'. Dry-run is the default. */
  dryRun: boolean;
  githubToken: string | undefined;
  /** From GITHUB_REPOSITORY ("owner/repo"); undefined when unset or malformed. */
  repository: { owner: string; repo: string } | undefined;
  /** Repo root: GITHUB_WORKSPACE in Actions, otherwise the current directory. */
  repoRoot: string;
  env: Env;
}

/** Dry-run unless DRY_RUN is exactly the string 'false'. */
export function isDryRun(env: Env = process.env): boolean {
  return env.DRY_RUN !== 'false';
}

export function parseRepository(value: string | undefined): AgentConfig['repository'] {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(value ?? '');
  return m ? { owner: m[1] as string, repo: m[2] as string } : undefined;
}

export function loadConfig(env: Env = process.env, cwd: string = process.cwd()): AgentConfig {
  return {
    dryRun: isDryRun(env),
    githubToken: env.GITHUB_TOKEN || undefined,
    repository: parseRepository(env.GITHUB_REPOSITORY),
    repoRoot: env.GITHUB_WORKSPACE || cwd,
    env,
  };
}

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD)/i;

/**
 * Values of env vars that look secret (name contains KEY/TOKEN/SECRET/PASSWORD), at least 8
 * chars long. The logger replaces these wherever they appear.
 */
export function secretValues(env: Env): string[] {
  return Object.entries(env)
    .filter(([k, v]) => SECRET_NAME.test(k) && typeof v === 'string' && v.length >= 8)
    .map(([, v]) => v as string);
}
