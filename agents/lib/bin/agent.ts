// Entry point for `npm run agent -- <name>` (runs the compiled agents/dist/lib/bin/agent.js).
import { runCli } from '../src/cli.js';

process.exitCode = await runCli(process.argv.slice(2));
