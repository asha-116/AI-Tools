// Demand Researcher pipeline (agents/demand-researcher/PROCEDURE.md): seeds → polite fetches of
// enabled autocomplete sources → strip PII → cluster into ideas (LLM, schema-validated) → score →
// de-dup against tools and open `type:idea` Issues → open Issues (dry-run by default).
// With no source enabled it reports waitlist counts only and says so.

import { appendFileSync } from 'node:fs';
import {
  chatJson,
  LlmUnavailable,
  promptSections,
  renderTemplate,
  runAgent,
  type AgentContext,
  type Env,
  type RunOptions,
} from '../../lib/src/index.js';
import { fsRepo, readText, type RepoReader } from '../../seo-listing/src/repo.js';
import { TOOLS } from '../../seo-listing/src/tools.js';
import { IdeasSchema, type Idea } from '../schema.js';
import { PoliteFetcher } from './fetcher.js';
import {
  buildSeeds,
  escalationReasons,
  ideaKey,
  isDuplicate,
  sanitize,
  totalScore,
} from './ideas.js';
import {
  enabledSources,
  loadSources,
  parseSuggestions,
  sourceOrigin,
  sourceUrl,
} from './sources.js';

export const AGENT = 'demand-researcher';
export const MAX_ISSUES = 5;

export interface ResearchDeps {
  repo?: RepoReader;
  /** Overrides agents/demand-researcher/sources.json (tests). */
  sourcesJson?: string;
  /** For the research sources only (the LLM and GitHub clients have their own). */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  env?: Env;
}

export interface WaitlistRow {
  id: string;
  title: string;
  count: number | undefined;
}

export interface ScoredIdea extends Idea {
  total: number;
  key: string;
}

export interface ResearchResult {
  status: 'no-sources' | 'no-evidence' | 'no-llm' | 'done';
  message: string;
  waitlist: WaitlistRow[];
  fetches: number;
  ideas: ScoredIdea[];
  issues: number[];
}

/** `WAITLIST_COUNTS` env: JSON object {ideaId: count}. Undefined when unset or invalid. */
export function parseWaitlistCounts(raw: string | undefined): Record<string, number> | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) {
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0) out[k] = n;
    }
    return out;
  } catch {
    return undefined;
  }
}

interface WaitlistIdea {
  id: string;
  title: { en: string; hi: string };
}

function waitlistRows(ideas: WaitlistIdea[], counts: Record<string, number> | undefined) {
  return ideas
    .map((i) => ({ id: i.id, title: i.title.en, count: counts?.[i.id] }))
    .sort((a, b) => (b.count ?? -1) - (a.count ?? -1));
}

export function issueBody(idea: ScoredIdea): string {
  return [
    `<!-- demand-researcher:idea:${idea.key} -->`,
    idea.description,
    '',
    `**Score: ${idea.total}** = demand ${idea.scores.demand} × 2 + effort ${idea.scores.effort} (5 = easiest) + uniqueness ${idea.scores.uniqueness}`,
    '',
    `Free or paid: ${idea.free_or_paid} · Languages: ${idea.languages.join(', ')}`,
    '',
    'Evidence (public search suggestions, personal data stripped):',
    ...idea.evidence.map((e) => `- ${e.url}${e.note ? ` — ${e.note}` : ''}`),
    '',
    'Next step: a landing-page / waitlist test before any build (PROCEDURE step 6).',
  ].join('\n');
}

export async function research(
  ctx: AgentContext,
  deps: ResearchDeps = {},
): Promise<ResearchResult> {
  const env = deps.env ?? ctx.config.env;
  const repo = deps.repo ?? fsRepo(ctx.config.repoRoot);
  const sources = enabledSources(loadSources(deps.sourcesJson ?? ctx.readFile('sources.json')));
  const waitlistIdeas = (
    JSON.parse(readText(repo, 'data/waitlist-ideas.json') || '{"ideas":[]}') as {
      ideas: WaitlistIdea[];
    }
  ).ideas;
  const counts = parseWaitlistCounts(env.WAITLIST_COUNTS);
  const waitlist = waitlistRows(waitlistIdeas, counts);
  const base = { waitlist, fetches: 0, ideas: [] as ScoredIdea[], issues: [] as number[] };
  const summary = (title: string, extra: string[] = []) => {
    const file = env.GITHUB_STEP_SUMMARY;
    if (!file) return;
    const rows = waitlist.map((w) => `| ${w.title} | ${w.count ?? 'n/a'} |`);
    appendFileSync(
      file,
      [
        `## Demand Researcher: ${title}`,
        '',
        '| Idea | Waitlist |',
        '| --- | ---: |',
        ...rows,
        '',
        ...extra,
        '',
      ].join('\n'),
    );
  };

  if (!counts)
    ctx.log.info('research.waitlist', { message: 'WAITLIST_COUNTS not set — counts skipped' });
  else
    ctx.log.info('research.waitlist', {
      waitlist: waitlist.map((w) => `${w.id}=${w.count ?? 'n/a'}`),
    });

  if (sources.length === 0) {
    const message =
      'no sources enabled — set terms_checked and enabled in agents/demand-researcher/sources.json after the owner checks each source’s terms; reported waitlist counts only';
    ctx.log.warn('research.no-sources', { message });
    summary('no sources enabled', [message]);
    return { status: 'no-sources', message, ...base };
  }

  // 1–2. Seeds → suggestions, politely.
  const names = [
    ...TOOLS.map((t) => ({ en: t.text.en.h1, hi: t.text.hi.h1 })),
    ...waitlistIdeas.map((i) => i.title),
  ];
  const seeds = buildSeeds(names);
  const fetcher = new PoliteFetcher({
    fetch: deps.fetch ?? fetch,
    allowedOrigins: sources.map(sourceOrigin),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
  const evidence: { url: string; text: string }[] = [];
  const skipped: Record<string, number> = {};
  for (const seed of seeds) {
    for (const source of sources.filter((s) => s.languages.includes(seed.lang))) {
      if (fetcher.exhausted) break;
      const res = await fetcher.get(sourceUrl(source, seed.q, seed.lang));
      if (!res.ok) {
        skipped[res.reason] = (skipped[res.reason] ?? 0) + 1;
        continue;
      }
      const suggestions = parseSuggestions(source.format, res.text).map(sanitize);
      if (suggestions.length) evidence.push({ url: res.url, text: suggestions.join(' | ') });
    }
  }
  ctx.log.info('research.collected', {
    fetches: fetcher.count,
    evidence: evidence.length,
    skipped,
  });
  base.fetches = fetcher.count;
  if (evidence.length === 0) {
    const message = 'no evidence collected (all fetches refused or empty)';
    ctx.log.warn('research.no-evidence', { message, skipped });
    summary(message);
    return { status: 'no-evidence', message, ...base };
  }

  // 3. Existing tools + open idea Issues (de-dup).
  const existing = [...names.map((n) => n.en)];
  try {
    const open = await ctx.github.searchIssues('is:issue is:open label:"type:idea"', 100);
    existing.push(...open.map((i) => i.title.replace(/^Idea:\s*/i, '')));
  } catch (e) {
    if (!ctx.dryRun) throw e;
    ctx.log.warn('research.issues-unreadable', {
      message: 'could not read open type:idea Issues (dry run) — de-dup against tools only',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 4. Cluster with the LLM.
  const p = promptSections(ctx.readFile('prompt.md'));
  const user = renderTemplate(String(p.user), {
    existing: existing.map((t) => `- ${t}`).join('\n'),
    waitlist: waitlist.map((w) => `- ${w.title}: ${w.count ?? 'n/a'}`).join('\n'),
    evidence: evidence.map((e, i) => `[${i + 1}] ${e.url} — ${e.text}`).join('\n'),
  });
  let ideas: Idea[];
  try {
    const r = await chatJson(
      ctx.llm,
      {
        messages: [
          { role: 'system', content: String(p.system) },
          { role: 'user', content: user },
        ],
      },
      IdeasSchema,
      'demand-researcher ideas',
      { log: ctx.log },
    );
    ideas = r.data.ideas;
  } catch (e) {
    if (e instanceof LlmUnavailable && e.attempts.length === 0) {
      const message = `no LLM API key set — collected ${evidence.length} evidence items, no ideas clustered`;
      ctx.log.warn('research.no-llm', { message });
      summary(message);
      return { status: 'no-llm', message, ...base };
    }
    throw e;
  }

  // 5. Validate evidence, score, de-dup, escalate.
  const known = new Set(evidence.map((e) => e.url));
  const kept: ScoredIdea[] = [];
  for (const idea of ideas) {
    const ev = idea.evidence.filter(
      (e, i, all) => known.has(e.url) && all.findIndex((x) => x.url === e.url) === i,
    );
    const drop = (reason: string) =>
      ctx.log.info('research.dropped', { title: idea.title, reason });
    if (ev.length < 2) {
      drop('fewer than 2 evidence URLs from this run');
      continue;
    }
    if (isDuplicate(idea.title, [...existing, ...kept.map((k) => k.title)])) {
      drop('duplicate of an existing tool or idea');
      continue;
    }
    const reasons = escalationReasons(`${idea.title}\n${idea.description}`);
    if (reasons.length) {
      await ctx.escalate({
        title: `Idea needs owner review: ${idea.title}`.slice(0, 100),
        context: `The Demand Researcher found this idea but it ${reasons.join('; ')}.\n\n${idea.description}`,
        options: ['Approve it as a type:idea Issue.', 'Reject it.'],
        recommendation: 'Reject unless it can be done without advice or regulated activity.',
        key: `idea-${ideaKey(idea.title)}`,
      });
      drop(reasons.join('; '));
      continue;
    }
    kept.push({ ...idea, evidence: ev, total: totalScore(idea.scores), key: ideaKey(idea.title) });
  }
  kept.sort((a, b) => b.total - a.total || b.scores.demand - a.scores.demand);

  // 6. Issues: one per idea, then a waitlist-test follow-up for the top one.
  const issues: number[] = [];
  for (const idea of kept.slice(0, MAX_ISSUES)) {
    const r = await ctx.github.createIssue({
      title: `Idea: ${idea.title}`,
      body: issueBody(idea),
      labels: ['type:idea'],
    });
    issues.push(r.number);
  }
  const top = kept[0];
  if (top) {
    const r = await ctx.github.createIssue({
      title: `Waitlist test: ${top.title}`,
      body: [
        `<!-- demand-researcher:waitlist-test:${top.key} -->`,
        `Top idea this week (score ${top.total}). Before any build: add it to data/waitlist-ideas.json`,
        'as a landing-page card and measure sign-ups (PROCEDURE step 6). Owner decides.',
      ].join('\n'),
      labels: ['type:idea'],
    });
    issues.push(r.number);
  }
  const message = `${kept.length} new idea(s) from ${evidence.length} evidence items; ${issues.length} Issue(s)${ctx.dryRun ? ' (dry run: none opened)' : ''}`;
  ctx.log.info('research.done', { message, fetches: fetcher.count });
  summary(
    message,
    kept.map((k) => `- ${k.total}: ${k.title}`),
  );
  return { status: 'done', message, ...base, ideas: kept, issues };
}

/** Entry point for `npm run agent -- demand-researcher`. Budget from PROCEDURE.md. */
export function main(options?: RunOptions, deps: ResearchDeps = {}) {
  return runAgent(AGENT, { perRun: 40_000, daily: 60_000 }, (ctx) => research(ctx, deps), options);
}
