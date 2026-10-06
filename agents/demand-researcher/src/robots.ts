// Minimal robots.txt parser + matcher (RFC 9309): user-agent groups, Allow/Disallow with `*`
// and `$`, longest match wins, Allow wins a tie. Pure.

export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export const ALLOW_ALL: RobotsRules = { allow: [], disallow: [] };
export const DISALLOW_ALL: RobotsRules = { allow: [], disallow: ['/'] };

/**
 * Rules for our crawler: the groups whose user-agent token appears in `productToken`
 * (case-insensitive), else the `*` groups, else allow all.
 */
export function parseRobots(text: string, productToken: string): RobotsRules {
  const token = productToken.toLowerCase();
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (m[1] as string).toLowerCase();
    const value = (m[2] as string).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || value === '') continue;
    if (key === 'allow') current.rules.allow.push(value);
    if (key === 'disallow') current.rules.disallow.push(value);
  }
  const pick = (pred: (a: string) => boolean) => {
    const hit = groups.filter((g) => g.agents.some(pred));
    return hit.length
      ? {
          allow: hit.flatMap((g) => g.rules.allow),
          disallow: hit.flatMap((g) => g.rules.disallow),
        }
      : undefined;
  };
  return pick((a) => a !== '*' && token.includes(a)) ?? pick((a) => a === '*') ?? { ...ALLOW_ALL };
}

function matchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    `^${body
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}${anchored ? '$' : ''}`,
  );
  return re.test(path) ? body.length : -1;
}

/** Is `path` (path + query) allowed? */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  const best = (patterns: string[]) => Math.max(-1, ...patterns.map((p) => matchLength(p, path)));
  const allow = best(rules.allow);
  const disallow = best(rules.disallow);
  return disallow < 0 || allow >= disallow;
}
