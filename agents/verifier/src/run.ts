// Verifier: independent second opinion on PRs that touch formulas, data, prices, legal or
// published text (agents/verifier/PROCEDURE.md). Sets the `verifier` commit status and keeps
// one PR comment up to date. Never self-verifies, never edits code.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  availableProviders,
  chatJson,
  DEFAULT_REPOSITORY,
  LlmUnavailable,
  loadProviders,
  promptSections,
  redact,
  renderTemplate,
  runAgent,
  type AgentContext,
  type CommitStatus,
  type Provider,
  type RunOptions,
} from '../../lib/src/index.js';
import { ClaimsReviewSchema, formulaAnswersFor, type VerifierReport } from '../schema.js';
import {
  allocate,
  FORMULAS,
  loadCases,
  runOurs,
  sampleCases,
  selectEntries,
  withinTolerance,
  type FormulaCase,
  type FormulaEntry,
} from './formulas.js';
import { createPrReader, type PrInfo, type PrReader } from './pr.js';
import { renderComment, statusFor } from './report.js';
import { addedLines, APPROVAL_LABEL, classify, producerFamily, type ChangedFile } from './scope.js';

export const BUDGET = { perRun: 30_000, daily: 200_000 };
export const MAX_CASES = 10;
const MAX_FILE_CHARS = 4_000;
const MAX_TEXT_CHARS = 12_000;

/** The disclaimer every money article / calculator carries (company/policies/disclaimers.md). */
export const DISCLAIMERS = ['verify with a professional', 'किसी विशेषज्ञ से पुष्टि करें'];

export interface VerifierDeps {
  reader?: PrReader;
  providers?: Provider[];
  registry?: FormulaEntry[];
  /** Reads a repo file from the checked-out PR (fixtures). */
  readRepoFile?: (path: string) => string;
  maxCases?: number;
}

export type VerifyResult =
  { skipped: string } | { report: VerifierReport; status: CommitStatus; commented: boolean };

type Row = VerifierReport['cases'][number];
type Claim = VerifierReport['claims'][number];

const URL_RE = /https?:\/\/[^\s)"'<>\]`|,]+/g;

/** URLs mentioned anywhere in the given texts (trailing punctuation trimmed). */
export function extractUrls(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.match(URL_RE) ?? []) out.add(m.replace(/[.;:]+$/, ''));
  return [...out];
}

/** `--pr 12`, `--pr=12`, else env PR_NUMBER. */
export function parsePrNumber(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): number | undefined {
  let raw: string | undefined;
  argv.forEach((a, i) => {
    if (a === '--pr') raw = argv[i + 1];
    else if (a.startsWith('--pr=')) raw = a.slice(5);
  });
  raw ??= env.PR_NUMBER;
  return raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : undefined;
}

function runUrl(env: Record<string, string | undefined>): string | undefined {
  return env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : undefined;
}

interface Prompts {
  'formula-system': string;
  'formula-user': string;
  'claims-system': string;
  'claims-user': string;
}

function loadPrompts(ctx: AgentContext): Prompts {
  const p = promptSections(ctx.readFile('prompt.md'));
  const get = (k: keyof Prompts): string => {
    const v = p[k];
    if (!v) throw new Error(`agents/verifier/prompt.md is missing "## ${k}"`);
    return v;
  };
  return {
    'formula-system': get('formula-system'),
    'formula-user': get('formula-user'),
    'claims-system': get('claims-system'),
    'claims-user': get('claims-user'),
  };
}

interface Sampled {
  entry: FormulaEntry;
  cases: { c: FormulaCase; ours: ReturnType<typeof runOurs> }[];
}

async function computeWithLlm(
  ctx: AgentContext,
  prompts: Prompts,
  s: Sampled,
  only: Set<string> | undefined,
  exclude: string[],
  families: Set<string>,
): Promise<Map<string, Record<string, number>>> {
  const cases = s.cases.filter((x) => !only || only.has(x.c.id));
  const requested = cases.map((x) => ({ id: x.c.id, fields: s.entry.fields(x.c.input) }));
  const payload = cases.map((x, i) => ({
    id: x.c.id,
    input: x.c.input,
    fields: requested[i]?.fields,
  }));
  const { data, response } = await chatJson(
    ctx.llm,
    {
      messages: [
        { role: 'system', content: prompts['formula-system'] },
        {
          role: 'user',
          content: renderTemplate(prompts['formula-user'], {
            description: s.entry.description,
            note: only
              ? 'RE-CHECK: an earlier answer for these cases disagreed with another computation. Recompute carefully from the description.'
              : '',
            cases: JSON.stringify(payload, null, 1),
          }),
        },
      ],
      temperature: 0,
      excludeFamily: exclude,
    },
    formulaAnswersFor(requested),
    `verifier ${s.entry.id} cases`,
    { log: ctx.log },
  );
  families.add(response.family);
  return new Map(data.results.map((r) => [r.id, r.values]));
}

async function checkFormulas(
  ctx: AgentContext,
  prompts: Prompts,
  sampled: Sampled[],
  exclude: string[],
  families: Set<string>,
): Promise<{ rows: Row[]; disagreements: number; errors: number }> {
  const rows: Row[] = [];
  let disagreements = 0;
  let errors = 0;
  for (const s of sampled) {
    // The schema guarantees every requested id and field is present in each answer.
    const first = await computeWithLlm(ctx, prompts, s, undefined, exclude, families);
    const answer = (m: Map<string, Record<string, number>>, id: string, field: string) =>
      (m.get(id) as Record<string, number>)[field] as number;
    // Re-check only cases our function could compute and the model disagreed on.
    const retry = new Set(
      s.cases
        .filter(
          (x) =>
            'values' in x.ours &&
            Object.entries(x.ours.values).some(
              ([f, v]) => !withinTolerance(answer(first, x.c.id, f), v),
            ),
        )
        .map((x) => x.c.id),
    );
    const second = retry.size
      ? await computeWithLlm(ctx, prompts, s, retry, exclude, families)
      : new Map<string, Record<string, number>>();
    for (const { c, ours } of s.cases) {
      for (const field of s.entry.fields(c.input)) {
        const v1 = answer(first, c.id, field);
        const base = { formula: s.entry.functionName, input: c.input, field };
        if ('error' in ours) {
          errors++;
          rows.push({
            ...base,
            expected_by_verifier: v1,
            actual: null,
            match: false,
            note: `our function threw: ${ours.error}`,
          });
          continue;
        }
        const actual = ours.values[field] as number;
        const rechecked = retry.has(c.id);
        const v2 = rechecked ? answer(second, c.id, field) : v1;
        const match = withinTolerance(v1, actual) || withinTolerance(v2, actual);
        if (!match) disagreements++;
        rows.push({
          ...base,
          expected_by_verifier: withinTolerance(v1, actual) ? v1 : v2,
          actual,
          match,
          note:
            !rechecked || withinTolerance(v1, actual)
              ? ''
              : match
                ? 'matched on re-check'
                : 'disagrees after re-check',
        });
      }
    }
  }
  return { rows, disagreements, errors };
}

async function checkClaims(
  ctx: AgentContext,
  prompts: Prompts,
  files: ChangedFile[],
  sources: string[],
  exclude: string[],
  families: Set<string>,
): Promise<{ claims: Claim[]; reasons: string[] }> {
  let budget = MAX_TEXT_CHARS;
  const parts: string[] = [];
  for (const f of files) {
    if (budget <= 0) {
      parts.push(`### ${f.filename}\n(not reviewed: text limit reached — review by hand)`);
      continue;
    }
    // AGENTS.md rule 2: redact before any LLM call, even for repo text.
    const text = redact(addedLines(f.patch)).text.slice(0, Math.min(MAX_FILE_CHARS, budget));
    budget -= text.length;
    parts.push(`### ${f.filename}\n${text}`);
  }
  const { data, response } = await chatJson(
    ctx.llm,
    {
      messages: [
        { role: 'system', content: prompts['claims-system'] },
        {
          role: 'user',
          content: renderTemplate(prompts['claims-user'], {
            files: parts.join('\n\n'),
            sources: sources.length ? sources.map((s) => `- ${s}`).join('\n') : '(none)',
          }),
        },
      ],
      temperature: 0,
      excludeFamily: exclude,
    },
    ClaimsReviewSchema,
    'verifier claims',
    { log: ctx.log },
  );
  families.add(response.family);
  const known = new Set(sources);
  /** Files whose own added lines cite at least one URL (e.g. a data file's `sources`). */
  const citing = new Set(
    files.filter((f) => extractUrls(f.patch ?? '').length > 0).map((f) => f.filename),
  );
  const reasons: string[] = [];
  const claims: Claim[] = data.claims.map((c) => {
    let { status, note } = c;
    // A source the model names must really be cited in this PR; otherwise it is unsourced.
    if ((status === 'supported' || status === 'unchecked') && !known.has(c.source)) {
      status = 'unsourced';
      note = `${note} (cited URL not found in this PR)`.trim();
    }
    // A claim the model left without a source, in a file that cites its own sources, is not
    // unsourced: a person checks it against them. A URL the model invented stays unsourced.
    if (status === 'unsourced' && c.source.trim() === '' && citing.has(c.file)) {
      status = 'unchecked';
      note = `${note} (the file cites sources; check this claim against them by hand)`.trim();
    }
    if (status === 'contradicted')
      reasons.push(`claim contradicted by its source (${c.file}): ${c.claim}`);
    if (status === 'unsourced') reasons.push(`unsourced claim (${c.file}): ${c.claim}`);
    return {
      file: c.file,
      claim: c.claim,
      source: c.source,
      supported: status === 'supported',
      status,
      note,
    };
  });
  for (const a of data.advice) reasons.push(`advice-like language (${a.file}): ${a.text}`);
  for (const m of data.missing_disclaimer) reasons.push(`missing disclaimer: ${m.file}`);
  return { claims, reasons };
}

/** The Verifier pipeline for one PR. */
export async function verify(
  ctx: AgentContext,
  prNumber: number,
  deps: VerifierDeps = {},
): Promise<VerifyResult> {
  const env = ctx.config.env;
  const repository = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const reader =
    deps.reader ??
    (ctx.config.githubToken
      ? createPrReader({ repository, token: ctx.config.githubToken })
      : undefined);
  if (!reader) {
    const msg = `not configured: GITHUB_TOKEN is not set, so PR #${String(prNumber)} cannot be read — nothing verified, no status set`;
    ctx.log.warn('verifier.not_configured', { pr: prNumber, reason: msg });
    return { skipped: msg };
  }

  const pr: PrInfo = await reader.getPull(prNumber);
  const files = await reader.listFiles(prNumber);
  const scope = classify(files);
  const producer = producerFamily(pr.body);
  const report: VerifierReport = {
    pr: prNumber,
    verifier_model_family: 'none',
    producer_model_family: producer ?? 'unknown',
    cases: [],
    claims: [],
    verdict: 'pass',
    reasons: [],
  };
  const target = runUrl(env);
  const finish = async (
    headline: string,
    state?: CommitStatus['state'],
    notes: string[] = [],
    comment = true,
  ) => {
    const status = {
      ...statusFor(report, headline, state),
      ...(target ? { target_url: target } : {}),
    };
    await ctx.github.setCommitStatus(pr.headSha, status);
    if (comment) await ctx.github.upsertComment(prNumber, renderComment(report, headline, notes));
    ctx.log.info('verifier.done', {
      pr: prNumber,
      verdict: report.verdict,
      state: status.state,
      cases: report.cases.length,
      claims: report.claims.length,
      producer: report.producer_model_family,
      verifier: report.verifier_model_family,
    });
    return { report, status, commented: comment };
  };

  if (!scope.applicable) {
    report.reasons.push('not applicable');
    return finish(
      'not applicable: no formula, data, price, legal or published-text changes',
      'success',
      [],
      false,
    );
  }
  if (pr.headRepo !== pr.baseRepo) {
    report.verdict = 'pending';
    report.reasons.push('PR comes from a fork; agents do not run fork code with secrets');
    return finish('fork PR: the owner must verify it by hand', 'pending');
  }
  if (!producer)
    ctx.log.info('verifier.producer_unknown', {
      pr: prNumber,
      note: 'no producer-family marker; any provider may verify',
    });

  // Step 4 (deterministic): prices and legal need the owner's label.
  if (scope.approvalReasons.length && !pr.labels.includes(APPROVAL_LABEL)) {
    for (const r of scope.approvalReasons)
      report.reasons.push(`needs \`${APPROVAL_LABEL}\` label — ${r}`);
  }

  // Step 2 inputs: sampled known-answer cases with our own outputs.
  const registry = deps.registry ?? FORMULAS;
  const read =
    deps.readRepoFile ?? ((p: string) => readFileSync(join(ctx.config.repoRoot, p), 'utf8'));
  const { entries, unregistered } = selectEntries(scope.formulaFiles, registry);
  for (const f of unregistered) {
    report.reasons.push(
      `no known-answer fixture registered for ${f} — add one (AGENTS.md "tests first") and an entry in agents/verifier/src/formulas.ts`,
    );
  }
  const quotas = allocate(deps.maxCases ?? MAX_CASES, entries.length);
  const sampled: Sampled[] = entries
    .map((entry, i) => ({
      entry,
      cases: sampleCases(loadCases(entry, read), quotas[i] as number, prNumber).map((c) => ({
        c,
        ours: runOurs(entry, c.input),
      })),
    }))
    .filter((s) => s.cases.length > 0);

  // Disclaimer check (deterministic) on published content.
  for (const path of scope.contentFiles) {
    const content = (await ctx.github.getFile(path, pr.headSha)) ?? '';
    if (!DISCLAIMERS.some((d) => content.includes(d)))
      report.reasons.push(`missing disclaimer: ${path}`);
  }

  const claimFiles = scope.textFiles.filter((f) => addedLines(f.patch).trim() !== '');
  const notes: string[] = [];
  if (!sampled.length && !claimFiles.length) {
    notes.push('no formula cases or added text to check with a model');
  } else {
    const exclude = producer ? [producer] : [];
    const providers = deps.providers ?? loadProviders();
    const independent = availableProviders(providers, env, exclude);
    if (independent.length === 0) {
      const any = availableProviders(providers, env);
      if (any.length === 0 && ctx.dryRun) {
        const msg =
          'verifier not configured: no LLM provider key set (dry-run) — formula and text checks skipped';
        ctx.log.warn('verifier.not_configured', { pr: prNumber, reason: msg });
        if (report.reasons.length) {
          report.verdict = 'fail';
          return finish(`fail: ${report.reasons[0] as string}`, 'failure', [msg]);
        }
        report.verdict = 'pending';
        return finish(msg, 'pending');
      }
      report.reasons.push(
        `no independent verifier: no provider outside the producer family "${producer ?? 'unknown'}" has a key — never self-verify`,
      );
      report.verdict = 'fail';
      return finish('no independent verifier', 'failure');
    }

    const prompts = loadPrompts(ctx);
    const families = new Set<string>();
    try {
      if (sampled.length) {
        const { rows, disagreements, errors } = await checkFormulas(
          ctx,
          prompts,
          sampled,
          exclude,
          families,
        );
        report.cases = rows;
        if (errors)
          report.reasons.push(`our function threw on ${String(errors)} known-answer value(s)`);
        if (disagreements) {
          report.reasons.push(
            `${String(disagreements)} formula value(s) disagree with the verifier after a re-check`,
          );
          await ctx.escalate({
            title: `Verifier disagrees with tools-core on PR #${String(prNumber)}`,
            context: `The independent verifier model and our implementation disagree on ${String(disagreements)} value(s) after a re-check. See the Verifier comment on PR #${String(prNumber)}.`,
            options: [
              'Check the cited sources by hand and fix the formula or the fixture.',
              'Re-run the Verifier (free models vary run to run).',
              'Accept the implementation and note why in the PR.',
            ],
            recommendation:
              'Recompute the disagreeing cases by hand from the cited source before merging.',
            key: `verifier-disagree-pr-${String(prNumber)}`,
          });
        }
      }
      if (claimFiles.length) {
        const sources = extractUrls(pr.body, ...files.map((f) => f.patch ?? ''));
        const { claims, reasons } = await checkClaims(
          ctx,
          prompts,
          claimFiles,
          sources,
          exclude,
          families,
        );
        report.claims = claims;
        report.reasons.push(...reasons);
      }
    } catch (e) {
      if (!(e instanceof LlmUnavailable)) throw e;
      report.verdict = 'pending';
      report.reasons.push(`verifier model unavailable: ${e.message}`);
      return finish('verifier model unavailable — re-run later', 'error');
    }
    report.verifier_model_family = [...families].join(', ');
  }

  report.verdict = report.reasons.length ? 'fail' : 'pass';
  const headline =
    report.verdict === 'pass'
      ? `pass: ${String(report.cases.length)} case value(s), ${String(report.claims.length)} claim(s) checked`
      : `fail: ${report.reasons[0] as string}`;
  return finish(headline, undefined, notes);
}

/** Entry point for `npm run agent -- verifier --pr <n>` (or env PR_NUMBER). */
export function main(
  options: RunOptions = {},
  argv: readonly string[] = process.argv.slice(2),
  deps: VerifierDeps = {},
) {
  return runAgent(
    'verifier',
    BUDGET,
    async (ctx) => {
      const pr = parsePrNumber(argv, ctx.config.env);
      if (pr === undefined)
        throw new Error('verifier needs a PR number: --pr <n> or env PR_NUMBER');
      return verify(ctx, pr, deps);
    },
    options,
  );
}
