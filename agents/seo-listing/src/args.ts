// CLI arguments after the agent name: `npm run agent -- <agent> --slug emi`.
// The shared CLI calls main() with no arguments, so agents read process.argv themselves.

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** Arguments after `node agent.js <name>`. */
export function cliArgs(argv: readonly string[] = process.argv): string[] {
  return argv.slice(3);
}

/** Value of `--name value` or `--name=value`; undefined when absent or empty. */
export function argValue(args: readonly string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === `--${name}`) return args[i + 1] || undefined;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3) || undefined;
  }
  return undefined;
}

/** `--slug`, validated. Throws on a malformed slug so a bad workflow input fails loudly. */
export function slugArg(args: readonly string[]): string | undefined {
  const slug = argValue(args, 'slug');
  if (slug !== undefined && !SLUG_RE.test(slug)) throw new Error(`invalid --slug "${slug}"`);
  return slug;
}
