// Social pipeline (agents/social/PROCEDURE.md): draft a tutorial script, EN + HI captions, pin
// text and hashtags for one tool; check them; save company/social-queue/<date>-<slug>.md with
// status `draft` via a PR. It NEVER calls a social network: the only network calls are the LLM
// and GitHub (asserted in tests). The owner posts approved drafts by hand.

import {
  chatJson,
  Escalation,
  LlmUnavailable,
  promptSections,
  renderTemplate,
  runAgent,
  type AgentContext,
  type RunOptions,
} from '../../lib/src/index.js';
import { cliArgs, slugArg } from '../../seo-listing/src/args.js';
import { fsRepo, readText, type RepoReader } from '../../seo-listing/src/repo.js';
import {
  findTool,
  placeholderList,
  TOOLS,
  type ToolInfo,
  type WorkedExample,
} from '../../seo-listing/src/tools.js';
import { SocialDraftSchema, type SocialPost } from '../schema.js';
import {
  captionHook,
  draftProblems,
  escalationReasons,
  finalizePost,
  pickTool,
  postProblems,
  QUEUE_DIR,
  queuePath,
  renderPost,
  slugOfQueueFile,
} from './post.js';

export const AGENT = 'social';

export interface SocialOptions {
  /** A just-merged tool; absent = weekly evergreen tip. */
  slug: string | undefined;
  repo?: RepoReader;
  /** Candidate tools (default: the registry). */
  tools?: readonly ToolInfo[];
}

export type SocialResult =
  | { status: 'skipped'; reason: string }
  | { status: 'drafted'; path: string; pr: number; family: string; post: SocialPost };

function exampleOf(tool: ToolInfo, root: string): WorkedExample | undefined {
  const e = tool.example(root);
  return 'unavailable' in e ? undefined : e;
}

export async function social(ctx: AgentContext, opts: SocialOptions): Promise<SocialResult> {
  const root = ctx.config.repoRoot;
  const repo = opts.repo ?? fsRepo(root);
  const queue = repo.list(QUEUE_DIR);
  const postType = opts.slug ? 'new-tool' : 'weekly-tip';

  let tool: ToolInfo | undefined;
  if (opts.slug) {
    tool = findTool(opts.slug);
    if (!tool || !exampleOf(tool, root)) {
      throw new Escalation({
        title: `Social: cannot draft a post for "${opts.slug}"`,
        context: tool
          ? 'The tool has no publishable worked example yet (e.g. rates not verified).'
          : 'agents/seo-listing/src/tools.ts has no entry for this tool.',
        options: ['Add the tool entry / verify its data, then re-run.', 'Skip this post.'],
        recommendation: 'Skip for now; the weekly tip covers live tools.',
        key: `social-no-tool-${opts.slug}`,
      });
    }
  } else {
    tool = pickTool(opts.tools ?? TOOLS, queue, (t) => exampleOf(t, root) !== undefined);
    if (!tool) {
      const reason = 'no tool with a publishable worked example';
      ctx.log.warn('social.skipped', { reason });
      return { status: 'skipped', reason };
    }
  }
  const example = exampleOf(tool, root) as WorkedExample;
  const date = ctx.now().toISOString().slice(0, 10);
  const path = queuePath(date, tool.slug);
  if (repo.exists(path)) {
    const reason = `${path} already exists`;
    ctx.log.info('social.skipped', { reason });
    return { status: 'skipped', reason };
  }

  const recent = queue
    .filter((f) => slugOfQueueFile(f) === tool.slug)
    .slice(-3)
    .map((f) => captionHook(readText(repo, `${QUEUE_DIR}/${f}`)))
    .filter((h): h is string => Boolean(h));

  const p = promptSections(ctx.readFile('prompt.md'));
  const system = renderTemplate(String(p.system), {
    brand_voice: readText(repo, 'company/policies/brand-voice.md'),
  });
  const user = renderTemplate(String(p.user), {
    post_type:
      postType === 'new-tool'
        ? 'a new free tool just went live — show how to use it'
        : 'weekly evergreen tip using this tool',
    name_en: tool.text.en.h1,
    name_hi: tool.text.hi.h1,
    lead_en: tool.text.en.lead,
    placeholders_en: placeholderList(example, 'en'),
    placeholders_hi: placeholderList(example, 'hi'),
    recent: recent.length ? recent.map((h) => `- ${h}`).join('\n') : '- (none)',
  });
  const schema = SocialDraftSchema.superRefine((d, c) => {
    for (const message of draftProblems(d, example)) c.addIssue({ code: 'custom', message });
  });

  let result: Awaited<ReturnType<typeof chatJson<typeof schema>>>;
  try {
    result = await chatJson(
      ctx.llm,
      {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
      },
      schema,
      'social draft',
      { log: ctx.log },
    );
  } catch (e) {
    if (e instanceof LlmUnavailable && e.attempts.length === 0) {
      const reason = `no LLM API key set — nothing drafted (would draft ${path})`;
      ctx.log.warn('social.skipped', { reason });
      return { status: 'skipped', reason };
    }
    throw e;
  }
  const { data, response } = result;

  const reasons = escalationReasons(data);
  if (reasons.length) {
    throw new Escalation({
      title: `Social: draft for "${tool.slug}" touches a topic the owner must review`,
      context: `The model's draft ${reasons.join('; ')}. Nothing was saved.`,
      options: ['Re-run for a different angle.', 'Write this post by hand.'],
      recommendation: 'Re-run; posts stay on how-to topics.',
      key: `social-topic-${tool.slug}`,
    });
  }
  const post = finalizePost(data, tool, example);
  const final = postProblems(post, tool);
  if (final.length) throw new Error(`social post failed final checks: ${final.join('; ')}`);

  const family = response.family;
  const content = renderPost(post, { date, postType, family });
  const pr = await ctx.github.openPullRequest({
    branch: `agent/${AGENT}/${date}-${tool.slug}`,
    title: `docs(social): draft post for ${tool.slug} (${date})`,
    body: [
      `Social draft for **${tool.slug}** (${postType}). Status: \`draft\` — nothing was posted.`,
      '',
      `Producer model family: \`${family}\``,
      `<!-- producer-family: ${family} -->`,
      '',
      'Checked by code: no income promises, no urgency, no @tags, links only to tools.changelense.in, disclaimer line, numbers from tools-core.',
      '',
      '- [ ] Owner: review (Hindi by a fluent speaker), then post by hand and record it.',
    ].join('\n'),
    files: [{ path, content }],
    commitMessage: `docs(social): draft post for ${tool.slug} (${date})`,
    labels: ['type:content', `agent:${AGENT}`],
  });
  ctx.log.info('social.done', { slug: tool.slug, path, pr: pr.number, dry_run: pr.dryRun });
  return { status: 'drafted', path, pr: pr.number, family, post };
}

/** Entry point for `npm run agent -- social [--slug <slug>]`. Budget from PROCEDURE.md. */
export function main(options?: RunOptions, argv: readonly string[] = cliArgs()) {
  return runAgent(
    AGENT,
    { perRun: 15_000, daily: 30_000 },
    (ctx) => social(ctx, { slug: slugArg(argv) }),
    options,
  );
}
