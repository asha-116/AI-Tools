import { describe, expect, it } from 'vitest';
import { checkAgentsConfig, describeMode } from '../check-agents-config.mjs';

const live = {
  AGENTS_ENABLED: 'true',
  AGENTS_LIVE: 'true',
  AGENT_APP_ID: '123456',
  HAS_AGENT_APP_PRIVATE_KEY: 'true',
  HAS_LLM_KEYS: '2',
};

describe('checkAgentsConfig', () => {
  it('passes the default (everything off) and a complete live setup', () => {
    expect(checkAgentsConfig({})).toEqual({ errors: [], warnings: [] });
    expect(checkAgentsConfig({ AGENTS_ENABLED: 'false', HAS_LLM_KEYS: '0' })).toEqual({
      errors: [],
      warnings: [],
    });
    expect(checkAgentsConfig(live)).toEqual({ errors: [], warnings: [] });
  });

  it('fails when AGENTS_LIVE is on without the GitHub App', () => {
    const r = checkAgentsConfig({ ...live, AGENT_APP_ID: '', HAS_AGENT_APP_PRIVATE_KEY: 'false' });
    expect(r.errors).toEqual([expect.stringContaining('GitHub App is not set up')]);
  });

  it('fails when only half of the GitHub App is configured', () => {
    expect(
      checkAgentsConfig({ AGENT_APP_ID: '1', HAS_AGENT_APP_PRIVATE_KEY: 'false' }).errors,
    ).toEqual([expect.stringContaining('AGENT_APP_PRIVATE_KEY is missing')]);
    expect(checkAgentsConfig({ HAS_AGENT_APP_PRIVATE_KEY: 'true' }).errors).toEqual([
      expect.stringContaining('AGENT_APP_ID is missing'),
    ]);
    expect(
      checkAgentsConfig({ AGENT_APP_ID: 'my-app', HAS_AGENT_APP_PRIVATE_KEY: 'true' }).errors,
    ).toEqual([expect.stringContaining('numeric App ID')]);
  });

  it('fails when live is on but agents are not enabled, or enabled without LLM keys', () => {
    expect(checkAgentsConfig({ ...live, AGENTS_ENABLED: 'false' }).errors).toEqual([
      expect.stringContaining('AGENTS_ENABLED is not'),
    ]);
    expect(checkAgentsConfig({ ...live, HAS_LLM_KEYS: '0' }).errors).toEqual([
      expect.stringContaining('no free LLM key'),
    ]);
  });

  it('warns about values that look on but are not "true"', () => {
    expect(checkAgentsConfig({ AGENTS_ENABLED: 'yes', AGENTS_LIVE: 'TRUE' }).warnings).toEqual([
      expect.stringContaining('AGENTS_ENABLED is "yes"'),
      expect.stringContaining('AGENTS_LIVE is "TRUE"'),
    ]);
  });
});

describe('describeMode', () => {
  it('names the mode', () => {
    expect(describeMode({})).toContain('off');
    expect(describeMode({ AGENTS_ENABLED: 'true' })).toContain('dry runs');
    expect(describeMode(live)).toContain('live');
  });
});
