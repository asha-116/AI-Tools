// `npm run agent -- <name>`: load agents/<name>/src/run.js from the build and run its main().

import type { RunResult } from './run.js';
import { exitCode } from './run.js';

/** What every agents/<name>/src/run.ts must export. */
export interface AgentModule {
  main: () => Promise<RunResult<unknown>>;
}

export type AgentLoader = (name: string) => Promise<Partial<AgentModule>>;

/** Resolves agents/<name>/src/run.js next to this file's build location (agents/dist/lib/src). */
export const defaultLoader: AgentLoader = (name) =>
  import(new URL(`../../${name}/src/run.js`, import.meta.url).href) as Promise<
    Partial<AgentModule>
  >;

/** Returns the process exit code: 0 ok / escalated / budget stop, 1 error, 2 usage. */
export async function runCli(
  argv: readonly string[],
  load: AgentLoader = defaultLoader,
  print: (line: string) => void = (l) => process.stderr.write(`${l}\n`),
): Promise<number> {
  const name = argv[0];
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name) || name === 'lib') {
    print('usage: npm run agent -- <agent-name>   (e.g. orchestrator)');
    return 2;
  }
  let mod: Partial<AgentModule>;
  try {
    mod = await load(name);
  } catch (e) {
    print(`cannot load agent "${name}": ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  if (typeof mod.main !== 'function') {
    print(`agents/${name}/src/run.ts must export main()`);
    return 2;
  }
  const result = await mod.main();
  print(`${name}: ${result.status} (${result.tokens} tokens)`);
  return exitCode(result);
}
