#!/usr/bin/env node
// Checks that the agent switches (docs/SETUP.md §3.4, §8) fit together, so a half-done setup is
// caught at once instead of every agent run silently falling back to a dry run.
// Run by .github/workflows/agents-config-check.yml, which passes only *whether* each secret is
// set ("true"/"false"), never its value.
//
// Env: AGENTS_ENABLED, AGENTS_LIVE, AGENT_APP_ID (variables);
//      HAS_AGENT_APP_PRIVATE_KEY, HAS_LLM_KEYS (counts of LLM key secrets set) from the workflow.
import { pathToFileURL } from 'node:url';

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkAgentsConfig(env) {
  const errors = [];
  const warnings = [];
  const enabled = env.AGENTS_ENABLED === 'true';
  const live = env.AGENTS_LIVE === 'true';
  const appId = (env.AGENT_APP_ID ?? '').trim();
  const hasKey = env.HAS_AGENT_APP_PRIVATE_KEY === 'true';
  const llmKeys = Number(env.HAS_LLM_KEYS ?? '0');

  if (appId !== '' && !/^\d+$/.test(appId)) {
    errors.push('AGENT_APP_ID must be the numeric App ID from the GitHub App settings page.');
  }
  if (appId !== '' && !hasKey) {
    errors.push(
      'AGENT_APP_ID is set but the secret AGENT_APP_PRIVATE_KEY is missing (SETUP §3.4).',
    );
  }
  if (appId === '' && hasKey) {
    errors.push(
      'The secret AGENT_APP_PRIVATE_KEY is set but the variable AGENT_APP_ID is missing (SETUP §3.4).',
    );
  }
  if (live) {
    if (!enabled) {
      errors.push(
        'AGENTS_LIVE is true but AGENTS_ENABLED is not, so no agent will run (SETUP §8).',
      );
    }
    if (appId === '' || !hasKey) {
      errors.push(
        'AGENTS_LIVE is true but the GitHub App is not set up, so every agent run stays a dry run (SETUP §3.4).',
      );
    }
  }
  if (enabled) {
    if (!(llmKeys >= 1)) {
      errors.push('AGENTS_ENABLED is true but no free LLM key secret is set (SETUP §8).');
    }
  } else if (
    env.AGENTS_ENABLED !== undefined &&
    env.AGENTS_ENABLED !== '' &&
    env.AGENTS_ENABLED !== 'false'
  ) {
    warnings.push(`AGENTS_ENABLED is "${env.AGENTS_ENABLED}"; only "true" switches agents on.`);
  }
  if (
    env.AGENTS_LIVE !== undefined &&
    env.AGENTS_LIVE !== '' &&
    env.AGENTS_LIVE !== 'true' &&
    env.AGENTS_LIVE !== 'false'
  ) {
    warnings.push(`AGENTS_LIVE is "${env.AGENTS_LIVE}"; only "true" makes agents write to GitHub.`);
  }
  return { errors, warnings };
}

/** One line describing the mode the agents will run in. @param {Record<string, string | undefined>} env */
export function describeMode(env) {
  if (env.AGENTS_ENABLED !== 'true') return 'Agents are off (AGENTS_ENABLED is not "true").';
  if (env.AGENTS_LIVE === 'true') return 'Agents run live: they may open Issues and PRs.';
  return 'Agents run as dry runs: they read and log, but write nothing to GitHub.';
}

/* c8 ignore start — process wiring */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { errors, warnings } = checkAgentsConfig(process.env);
  const annotate = process.env.GITHUB_ACTIONS === 'true';
  for (const w of warnings) console.log(annotate ? `::warning::${w}` : `warning: ${w}`);
  for (const e of errors) console.log(annotate ? `::error::${e}` : `error: ${e}`);
  if (errors.length > 0) process.exit(1);
  console.log(describeMode(process.env));
  console.log('Config OK');
}
/* c8 ignore stop */
