// Repo formatting for files an agent commits, so agent PRs pass `prettier --check` in CI.
// Uses the repo's own Prettier and config; a file Prettier does not handle (or ignores, or
// cannot parse) is committed unchanged.

import type { FileChange } from './github.js';

export type Formatter = (path: string, content: string) => Promise<string>;

export const prettierFormatter: Formatter = async (path, content) => {
  try {
    const prettier = await import('prettier');
    const info = await prettier.getFileInfo(path, { ignorePath: '.prettierignore' });
    if (info.ignored || !info.inferredParser) return content;
    const config = (await prettier.resolveConfig(path)) ?? {};
    return await prettier.format(content, { ...config, filepath: path });
  } catch {
    return content;
  }
};

/** Formats every added/changed file; deletions (null content) pass through. */
export async function formatFiles(
  files: readonly FileChange[],
  format: Formatter = prettierFormatter,
): Promise<FileChange[]> {
  return Promise.all(
    files.map(async (f) =>
      f.content === null ? f : { path: f.path, content: await format(f.path, f.content) },
    ),
  );
}
