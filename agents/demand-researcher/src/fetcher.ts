// Polite fetcher: allow-listed origins only, robots.txt checked (and cached) first, an honest
// user-agent, a per-origin rate limit, a hard cap of fetches per run, and a response cache.
// `fetch` is injected so tests never touch the network.

import { DISALLOW_ALL, isAllowed, parseRobots, type RobotsRules, ALLOW_ALL } from './robots.js';

export const USER_AGENT = 'ChangeLensResearchBot (+https://tools.changelense.in)';
export const ROBOTS_TOKEN = 'ChangeLensResearchBot';
export const MAX_FETCHES = 50;

export type FetchOutcome =
  | { ok: true; url: string; status: number; text: string }
  | { ok: false; url: string; reason: string };

export interface FetcherOptions {
  fetch: typeof fetch;
  /** Origins (https://host) of enabled sources. Anything else is refused. */
  allowedOrigins: readonly string[];
  maxFetches?: number;
  /** Minimum gap between two requests to the same origin. Default 2 s. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PoliteFetcher {
  /** Requests actually sent (robots.txt included). */
  count = 0;
  private readonly robots = new Map<string, RobotsRules>();
  private readonly cache = new Map<string, FetchOutcome>();
  private readonly last = new Map<string, number>();
  private readonly blocked = new Set<string>();
  private readonly max: number;
  private readonly interval: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly o: FetcherOptions) {
    this.max = o.maxFetches ?? MAX_FETCHES;
    this.interval = o.minIntervalMs ?? 2000;
    this.sleep = o.sleep ?? defaultSleep;
    this.now = o.now ?? Date.now;
  }

  get exhausted(): boolean {
    return this.count >= this.max;
  }

  private async send(url: URL): Promise<Response | Error> {
    const origin = url.origin;
    const wait = (this.last.get(origin) ?? -Infinity) + this.interval - this.now();
    if (wait > 0) await this.sleep(wait);
    this.last.set(origin, this.now());
    this.count++;
    try {
      return await this.o.fetch(url.href, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json, text/plain, */*' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }

  private async rulesFor(url: URL): Promise<RobotsRules | undefined> {
    const cached = this.robots.get(url.origin);
    if (cached) return cached;
    if (this.exhausted) return undefined;
    const res = await this.send(new URL('/robots.txt', url.origin));
    let rules: RobotsRules;
    if (res instanceof Error || res.status >= 500 || res.status === 401 || res.status === 403) {
      rules = DISALLOW_ALL; // unreachable or forbidden: assume we may not crawl
    } else if (res.ok) {
      rules = parseRobots(await res.text(), ROBOTS_TOKEN);
    } else {
      rules = ALLOW_ALL; // 404 etc.: no robots.txt
    }
    this.robots.set(url.origin, rules);
    return rules;
  }

  async get(href: string): Promise<FetchOutcome> {
    const url = new URL(href);
    const fail = (reason: string): FetchOutcome => ({ ok: false, url: href, reason });
    if (url.protocol !== 'https:' || !this.o.allowedOrigins.includes(url.origin)) {
      return fail('origin is not an enabled source');
    }
    const hit = this.cache.get(href);
    if (hit) return hit;
    if (this.blocked.has(url.origin)) return fail('origin rate-limited us earlier in this run');
    const rules = await this.rulesFor(url);
    if (!rules || this.exhausted) return fail(`fetch limit reached (${this.max})`);
    if (!isAllowed(rules, `${url.pathname}${url.search}`)) return fail('disallowed by robots.txt');
    const res = await this.send(url);
    let out: FetchOutcome;
    if (res instanceof Error) {
      out = fail(`network error (${res.name})`);
    } else if (!res.ok) {
      if (res.status === 429) this.blocked.add(url.origin);
      await res.body?.cancel().catch(() => undefined);
      out = fail(`HTTP ${res.status}`);
    } else {
      out = { ok: true, url: href, status: res.status, text: await res.text() };
    }
    this.cache.set(href, out);
    return out;
  }
}
