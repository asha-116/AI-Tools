// Read-only access to the checked-out repo (Actions checks it out; locally it is the cwd).
// Agents write to the repo only through ctx.github.openPullRequest().

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RepoReader {
  /** File content, or null when missing. `path` is repo-relative. */
  read(path: string): string | null;
  /** File names in a repo-relative directory ([] when missing). */
  list(dir: string): string[];
  exists(path: string): boolean;
}

function safe(path: string): string {
  if (path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error(`refusing path outside the repo: ${path}`);
  }
  return path;
}

export function fsRepo(root: string): RepoReader {
  return {
    read: (p) => {
      const full = join(root, safe(p));
      return existsSync(full) ? readFileSync(full, 'utf8') : null;
    },
    list: (d) => {
      const full = join(root, safe(d));
      return existsSync(full) ? readdirSync(full).sort() : [];
    },
    exists: (p) => existsSync(join(root, safe(p))),
  };
}

/** True when an internal site path (e.g. /tools/emi/ or /hi/) has an Astro page. */
export function pageExists(repo: RepoReader, path: string): boolean {
  if (!/^\/[a-z0-9/-]*$/.test(path) || path.includes('//')) return false;
  const p = path.endsWith('/') ? path : `${path}/`;
  return repo.exists(`site/src/pages${p}index.astro`);
}

/** File content, or '' when missing. */
export function readText(repo: RepoReader, path: string): string {
  return repo.read(path) ?? '';
}
