import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LlmUnavailable, type LlmClient, type LlmRequest } from '../../lib/src/index.js';
import { MemoryGitHub, fakeLlm, testContext, testRunOptions } from '../../lib/src/testing.js';
import { VerifierReportSchema } from '../schema.js';
import { FORMULAS, type FormulaEntry } from '../src/formulas.js';
import type { PrInfo, PrReader } from '../src/pr.js';
import { extractUrls, main, parsePrNumber, verify, type VerifierDeps } from '../src/run.js';
import type { ChangedFile } from '../src/scope.js';

const SHA = 'b'.repeat(40);
const KEYS = {
  DRY_RUN: 'true',
  // Assembled at runtime so the secret scanner never sees key-shaped literals.
  GROQ_API_KEY: ['gsk', 'fake'].join('_'),
  GEMINI_API_KEY: ['AIza', 'fake'].join('_'),
};

function reader(pr: Partial<PrInfo>, files: ChangedFile[]): PrReader & { calls: number } {
  const r = {
    calls: 0,
    async getPull(n: number): Promise<PrInfo> {
      r.calls++;
      return {
        number: n,
        title: 't',
        body: '<!-- producer-family: gemini -->',
        labels: [],
        draft: false,
        headSha: SHA,
        headRef: 'agent/builder/1-x',
        headRepo: 'asha-116/AI-Tools',
        baseRepo: 'asha-116/AI-Tools',
        ...pr,
      };
    },
    async listFiles() {
      return files;
    },
  };
  return r;
}

// ---- independent oracles (test-only), anchored to cited known answers below ----
function oracleEmi(i: Record<string, number>): Record<string, number> {
  const P = i.principal as number;
  const n = i.tenureMonths as number;
  const r = (i.annualRatePercent as number) / 1200;
  const emi = r === 0 ? P / n : (P * r * (1 + r) ** n) / ((1 + r) ** n - 1);
  return { emi, totalPayment: emi * n, totalInterest: emi * n - P };
}
type CommIn = {
  dealValue?: number;
  commission: { type: string; percent?: number; amount?: number };
  gstPercent: number;
  parties: { percent: number }[];
};
function oracleCommission(i: CommIn): Record<string, number> {
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const gross = round2(
    i.commission.type === 'fixed'
      ? (i.commission.amount as number)
      : ((i.dealValue as number) * (i.commission.percent as number)) / 100,
  );
  const gst = round2((gross * i.gstPercent) / 100);
  const out: Record<string, number> = { gross, gst, totalPayable: gross + gst };
  i.parties.forEach((p, k) => (out[`party_${String(k + 1)}`] = round2((gross * p.percent) / 100)));
  return out;
}

/** An LLM that answers formula prompts with the oracle (optionally skewed) and claims prompts with `claims`. */
/** Independent oracle: unit sizes in sq ft as the cited sources state them. */
const AREA_SQ_FT: Record<string, number> = {
  sq_ft: 1,
  sq_yd: 9,
  sq_m: 1 / 0.09290304,
  acre: 43560,
  hectare: 10000 / 0.09290304,
  guntha: 1089,
  cent: 435.6,
  ground: 2400,
  marla: 272.25,
  kanal: 5445,
};
function oracleArea(i: { value: number; from: string; to: string }): Record<string, number> {
  return { result: (i.value * (AREA_SQ_FT[i.from] ?? NaN)) / (AREA_SQ_FT[i.to] ?? NaN) };
}

function scriptedLlm(
  opts: { skew?: (id: string, call: number) => number; claims?: unknown; family?: string } = {},
): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let formulaCalls = 0;
  return {
    requests,
    familiesUsed: () => [opts.family ?? 'llama'],
    async chat(req) {
      requests.push(req);
      const user = req.messages[1]?.content ?? '';
      let text: string;
      if (user.includes('Cases (JSON):')) {
        formulaCalls++;
        const json = user.slice(user.indexOf('Cases (JSON):') + 13, user.indexOf('Reply as JSON'));
        const cases = JSON.parse(json) as { id: string; input: Record<string, unknown> }[];
        text = JSON.stringify({
          results: cases.map((c) => {
            const v = c.id.startsWith('emi')
              ? oracleEmi(c.input as Record<string, number>)
              : c.id.startsWith('area')
                ? oracleArea(c.input as { value: number; from: string; to: string })
                : oracleCommission(c.input as unknown as CommIn);
            const skew = opts.skew?.(c.id, formulaCalls) ?? 0;
            return {
              id: c.id,
              values: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x + skew])),
            };
          }),
        });
      } else {
        text = JSON.stringify(opts.claims ?? { claims: [], advice: [], missing_disclaimer: [] });
      }
      return {
        text,
        provider: 'groq',
        model: 'm',
        family: opts.family ?? 'llama',
        usage: { prompt: 10, completion: 5 },
      };
    },
  };
}

function ctxFor(github: MemoryGitHub, llm: LlmClient, env: Record<string, string> = KEYS) {
  return testContext('verifier', { github, llm, env });
}
const gh = (files: Record<string, string> = {}) =>
  new MemoryGitHub({ agent: 'verifier', dryRun: true, files });
const statuses = (g: MemoryGitHub) =>
  g.writes
    .filter((w) => w.action === 'setCommitStatus')
    .map((w) => w.args as Record<string, string>);
const comment = (g: MemoryGitHub, pr = 12) => g.comments.get(pr)?.[0] ?? '';

async function run(
  files: ChangedFile[],
  o: {
    pr?: Partial<PrInfo>;
    llm?: LlmClient & { requests: LlmRequest[] };
    env?: Record<string, string>;
    deps?: VerifierDeps;
    github?: MemoryGitHub;
  } = {},
) {
  const github = o.github ?? gh();
  const llm = o.llm ?? scriptedLlm();
  const r = await verify(ctxFor(github, llm, o.env), 12, {
    reader: reader(o.pr ?? {}, files),
    ...o.deps,
  });
  if ('skipped' in r) throw new Error('unexpected skip');
  VerifierReportSchema.parse(r.report);
  return { r, github, llm };
}

describe('test oracles match cited known answers', () => {
  it('EMI ₹10,00,000 @ 10.5% × 120 → ₹13,493 (emi-known-answers.json case 1)', () => {
    expect(
      Math.round(
        oracleEmi({ principal: 1000000, annualRatePercent: 10.5, tenureMonths: 120 }).emi as number,
      ),
    ).toBe(13493);
    expect(oracleEmi({ principal: 1200, annualRatePercent: 0, tenureMonths: 12 }).emi).toBe(100);
  });
  it('commission ₹1 crore @ 2% + 18% GST → ₹2,36,000 (commission-known-answers.json case 1)', () => {
    const c = oracleCommission({
      dealValue: 1e7,
      commission: { type: 'percent', percent: 2 },
      gstPercent: 18,
      parties: [{ percent: 100 }],
    });
    expect(c.totalPayable).toBe(236000);
    expect(
      oracleCommission({
        commission: { type: 'fixed', amount: 6000 },
        gstPercent: 0,
        parties: [{ percent: 50 }, { percent: 50 }],
      }).party_2,
    ).toBe(3000);
  });
});

describe('helpers', () => {
  it('parsePrNumber reads --pr, --pr= and PR_NUMBER', () => {
    expect(parsePrNumber(['verifier', '--pr', '12'], {})).toBe(12);
    expect(parsePrNumber(['--pr=7'], {})).toBe(7);
    expect(parsePrNumber([], { PR_NUMBER: '3' })).toBe(3);
    expect(parsePrNumber(['--pr', '0'], {})).toBeUndefined();
    expect(parsePrNumber(['--pr', '1; rm -rf /'], {})).toBeUndefined();
    expect(parsePrNumber(['--pr'], {})).toBeUndefined();
  });
  it('extractUrls dedupes and trims punctuation', () => {
    expect(extractUrls('see https://a.in/x. and (https://b.in/y)', '"https://a.in/x"')).toEqual([
      'https://a.in/x',
      'https://b.in/y',
    ]);
    expect(extractUrls('none')).toEqual([]);
  });
});

describe('verify — scope and deterministic checks', () => {
  it('skips with a clear message when GITHUB_TOKEN is not set', async () => {
    const r = await verify(testContext('verifier', { env: { DRY_RUN: 'true' } }), 12);
    expect(r).toEqual({
      skipped: expect.stringContaining('not configured: GITHUB_TOKEN is not set'),
    });
  });

  it('sets success "not applicable" without a comment for out-of-scope PRs', async () => {
    const { r, github } = await run([
      { filename: 'site/src/pages/index.astro', status: 'modified', patch: '+x' },
    ]);
    expect(statuses(github)).toEqual([
      {
        sha: SHA,
        context: 'verifier',
        state: 'success',
        description: expect.stringContaining('not applicable'),
      },
    ]);
    expect(github.comments.size).toBe(0);
    expect(r.report.verdict).toBe('pass');
  });

  it('leaves fork PRs pending for the owner', async () => {
    const { github } = await run([{ filename: 'tools-core/src/emi.ts', status: 'modified' }], {
      pr: { headRepo: 'someone/fork' },
    });
    expect(statuses(github)[0]?.state).toBe('pending');
    expect(comment(github)).toContain('fork');
  });

  it('fails legal changes without approved-by-owner even when no model is configured', async () => {
    const { r, github } = await run(
      [{ filename: 'legal/terms.md', status: 'modified', patch: '+New clause' }],
      { env: { DRY_RUN: 'true' } },
    );
    expect(r.status.state).toBe('failure');
    expect(r.report.reasons[0]).toContain(
      'needs `approved-by-owner` label — touches legal/policy text: legal/terms.md',
    );
    expect(comment(github)).toContain('no LLM provider key set');
  });

  it('fails a price change without approval', async () => {
    const { r } = await run(
      [
        {
          filename: 'products/catalog.json',
          status: 'modified',
          patch: '-  "price_inr": 199,\n+  "price_inr": 249,',
        },
      ],
      { env: { DRY_RUN: 'true' } },
    );
    expect(r.report.reasons[0]).toContain('changes a price: products/catalog.json');
  });

  it('is pending "not configured" in dry-run with no provider key at all', async () => {
    const { r, github } = await run(
      [{ filename: 'legal/terms.md', status: 'modified', patch: '+New clause' }],
      { env: { DRY_RUN: 'true' }, pr: { labels: ['approved-by-owner'] } },
    );
    expect(r.status).toMatchObject({
      state: 'pending',
      description: expect.stringContaining('verifier not configured'),
    });
    expect(r.report.verdict).toBe('pending');
    expect(github.comments.size).toBe(1);
  });

  it('fails "no independent verifier" when only the producer family has a key', async () => {
    const { r } = await run([{ filename: 'tools-core/src/emi.ts', status: 'modified' }], {
      env: { DRY_RUN: 'true', GEMINI_API_KEY: 'AIza_only_key_1' },
    });
    expect(r.status).toMatchObject({ state: 'failure', description: 'no independent verifier' });
    expect(r.report.reasons[0]).toContain('producer family "gemini"');
  });

  it('fails "no independent verifier" live with no keys at all (unknown producer)', async () => {
    const { r } = await run([{ filename: 'tools-core/src/emi.ts', status: 'modified' }], {
      env: { DRY_RUN: 'false', GITHUB_TOKEN: 'ghs_x' },
      pr: { body: '' },
    });
    expect(r.status.state).toBe('failure');
    expect(r.report.producer_model_family).toBe('unknown');
  });

  it('fails a formula file with no registered known-answer fixture, without calling a model', async () => {
    const llm = fakeLlm([]);
    const { r, github } = await run(
      [{ filename: 'tools-core/src/stampDuty.ts', status: 'modified' }],
      { llm },
    );
    expect(r.report.reasons[0]).toContain(
      'no known-answer fixture registered for tools-core/src/stampDuty.ts',
    );
    expect(llm.requests).toHaveLength(0);
    expect(comment(github)).toContain('no formula cases or added text');
  });

  it('passes in-scope changes with nothing to check (test-only or removed lines)', async () => {
    const { r } = await run([
      { filename: 'tools-core/test/emi.test.ts', status: 'modified' },
      { filename: 'data/stamp-duty/mh.json', status: 'modified', patch: '-old' },
    ]);
    expect(r.status.state).toBe('success');
  });

  it('adds the Actions run link to the status when available', async () => {
    const { r } = await run([{ filename: 'tools-core/test/emi.test.ts', status: 'modified' }], {
      env: {
        ...KEYS,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_RUN_ID: '9',
      },
    });
    expect(r.status.target_url).toBe('https://github.com/o/r/actions/runs/9');
  });
});

describe('verify — formulas (PROCEDURE step 2)', () => {
  it('samples 10 EMI cases, excludes the producer family and passes when values agree', async () => {
    const { r, github, llm } = await run([
      { filename: 'tools-core/src/emi.ts', status: 'modified' },
    ]);
    expect(r.status.state).toBe('success');
    expect(new Set(r.report.cases.map((c) => JSON.stringify(c.input))).size).toBe(10);
    expect(r.report.cases.every((c) => c.match)).toBe(true);
    expect(r.report.verifier_model_family).toBe('llama');
    expect(r.report.producer_model_family).toBe('gemini');
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]?.excludeFamily).toEqual(['gemini']);
    // Only inputs and the description are sent — never our code or the fixture's answers.
    const prompt = llm.requests[0]?.messages[1]?.content ?? '';
    expect(prompt).toContain('emi = P × r × (1 + r)^n');
    expect(prompt).not.toContain('13493');
    expect(prompt).not.toContain('computeEmi');
    expect(comment(github)).toContain('| computeEmi |');
  });

  it('splits cases across formulas and is deterministic per PR', async () => {
    const files = [{ filename: 'tools-core/src/numbers.ts', status: 'modified' }];
    const a = await run(files);
    const b = await run(files);
    expect(a.r.report.cases.map((c) => c.input)).toEqual(b.r.report.cases.map((c) => c.input));
    expect(new Set(a.r.report.cases.map((c) => c.formula))).toEqual(
      new Set(['computeEmi', 'computeCommission', 'convertArea']),
    );
    expect(a.r.status.state).toBe('success');
  });

  it('skips formulas whose quota is zero', async () => {
    const { llm } = await run([{ filename: 'tools-core/src/numbers.ts', status: 'modified' }], {
      deps: { maxCases: 1 },
    });
    expect(llm.requests).toHaveLength(1);
  });

  it('re-checks a disagreement and passes when the re-check agrees', async () => {
    const llm = scriptedLlm({ skew: (_id, call) => (call === 1 ? 500 : 0) });
    const { r } = await run(
      [{ filename: 'tools-core/test/fixtures/emi-known-answers.json', status: 'modified' }],
      { llm },
    );
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1]?.messages[1]?.content).toContain('RE-CHECK');
    expect(r.report.cases.filter((c) => c.note === 'matched on re-check').length).toBeGreaterThan(
      0,
    );
    expect(r.status.state).toBe('success');
  });

  it('fails and escalates when the verifier still disagrees after the re-check', async () => {
    const llm = scriptedLlm({ skew: () => 1e9 });
    const { r, github } = await run([{ filename: 'tools-core/src/emi.ts', status: 'modified' }], {
      llm,
      deps: { maxCases: 1 },
    });
    expect(r.status.state).toBe('failure');
    expect(r.report.reasons[0]).toMatch(/3 formula value\(s\) disagree/);
    expect(r.report.cases.filter((c) => c.note === 'disagrees after re-check')).toHaveLength(3);
    expect(github.issues[0]?.labels).toContain('needs-owner');
    expect(github.issues[0]?.title).toContain('PR #12');
  });

  it('reports when our function throws on a known-answer case', async () => {
    const emi = FORMULAS[0] as FormulaEntry;
    const broken: FormulaEntry = {
      ...emi,
      run: () => {
        throw new RangeError('boom');
      },
    };
    const { r } = await run([{ filename: 'tools-core/src/emi.ts', status: 'modified' }], {
      deps: { registry: [broken], maxCases: 2 },
    });
    expect(r.report.reasons).toContain('our function threw on 6 known-answer value(s)');
    expect(r.report.cases[0]).toMatchObject({
      actual: null,
      match: false,
      note: 'our function threw: boom',
    });
  });

  it('marks the run "error" (re-run later) when every provider fails', async () => {
    const llm = fakeLlm([
      new LlmUnavailable([{ provider: 'groq', status: 429, reason: 'HTTP 429' }]),
    ]);
    const { r } = await run([{ filename: 'tools-core/src/emi.ts', status: 'modified' }], { llm });
    expect(r.status.state).toBe('error');
    expect(r.report.reasons[0]).toContain('verifier model unavailable');
  });

  it('lets unexpected errors fail the run', async () => {
    const llm = fakeLlm([new Error('bug')]);
    await expect(
      run([{ filename: 'tools-core/src/emi.ts', status: 'modified' }], { llm }),
    ).rejects.toThrow('bug');
  });
});

describe('verify — claims and text (PROCEDURE step 3)', () => {
  const claims = {
    claims: [
      {
        file: 'data/x.json',
        claim: 'Stamp duty in MH is 6%',
        source: 'https://igrmaharashtra.gov.in/a',
        status: 'supported',
        note: 'quoted',
      },
      {
        file: 'data/x.json',
        claim: 'Registration is 1%',
        source: 'https://made-up.example/',
        status: 'supported',
        note: '',
      },
      {
        file: 'data/x.json',
        claim: 'Women get 1% off',
        source: 'https://igrmaharashtra.gov.in/a',
        status: 'contradicted',
        note: 'source says 1% only in some cases',
      },
      {
        file: 'data/x.json',
        claim: 'Metro cess 1%',
        source: 'https://igrmaharashtra.gov.in/a',
        status: 'unchecked',
        note: '',
      },
    ],
    advice: [{ file: 'site/src/content/en/a.md', text: 'You should claim this deduction' }],
    missing_disclaimer: [{ file: 'site/src/content/en/a.md' }],
  };

  it('checks claims against cited URLs, flags advice and missing disclaimers', async () => {
    const llm = scriptedLlm({ claims });
    const github = gh({ 'site/src/content/en/a.md': 'Some text without the disclaimer' });
    const { r } = await run(
      [
        {
          filename: 'data/x.json',
          status: 'modified',
          patch:
            '+ "rate": 6, "source_url": "https://igrmaharashtra.gov.in/a"\n+ "name": "Jane Doe <jane@example.com>"',
        },
        {
          filename: 'site/src/content/en/a.md',
          status: 'added',
          patch: '+You should claim this deduction',
        },
      ],
      { llm, github },
    );
    const sent = llm.requests[0]?.messages[1]?.content ?? '';
    expect(sent).toContain('- https://igrmaharashtra.gov.in/a');
    expect(sent).not.toContain('jane@example.com');
    expect(r.report.claims.map((c) => [c.status, c.supported])).toEqual([
      ['supported', true],
      ['unsourced', false],
      ['contradicted', false],
      ['unchecked', false],
    ]);
    expect(r.report.claims[1]?.note).toContain('not found in this PR');
    expect(r.report.reasons).toEqual([
      'missing disclaimer: site/src/content/en/a.md',
      'unsourced claim (data/x.json): Registration is 1%',
      'claim contradicted by its source (data/x.json): Women get 1% off',
      'advice-like language (site/src/content/en/a.md): You should claim this deduction',
      'missing disclaimer: site/src/content/en/a.md',
    ]);
    expect(r.status.state).toBe('failure');
  });

  it('a claim with no source is "check by hand" when its file cites sources, else unsourced', async () => {
    const noSource = (file: string) => ({
      file,
      claim: '1 cent = 435.6 sq ft',
      source: '',
      status: 'unsourced',
      note: '',
    });
    const llm = scriptedLlm({
      claims: {
        claims: [noSource('data/x.json'), noSource('site/src/content/en/a.md')],
        advice: [],
        missing_disclaimer: [],
      },
    });
    const github = gh({
      'site/src/content/en/a.md': 'For estimation only — verify with a professional.',
    });
    const { r } = await run(
      [
        {
          filename: 'data/x.json',
          status: 'added',
          patch: '+ "sources": [{ "url": "https://1acre.in/land-unit-converter/cent-to-sqft" }]',
        },
        { filename: 'site/src/content/en/a.md', status: 'added', patch: '+A cent is 435.6 sq ft' },
      ],
      { llm, github },
    );
    expect(r.report.claims.map((c) => c.status)).toEqual(['unchecked', 'unsourced']);
    expect(r.report.claims[0]?.note).toContain('check this claim against them by hand');
    expect(r.report.reasons).toEqual([
      'unsourced claim (site/src/content/en/a.md): 1 cent = 435.6 sq ft',
    ]);
  });

  it('accepts EN or HI disclaimers and passes clean text', async () => {
    const github = gh({
      'site/src/content/en/a.md': 'For estimation only — verify with a professional.',
      'site/src/content/hi/a.md': 'केवल अनुमान के लिए — किसी विशेषज्ञ से पुष्टि करें।',
    });
    const { r, llm } = await run(
      [
        { filename: 'site/src/content/en/a.md', status: 'added', patch: '+Hello' },
        { filename: 'site/src/content/hi/a.md', status: 'added', patch: '+नमस्ते' },
      ],
      { github },
    );
    expect(r.status.state).toBe('success');
    expect(llm.requests[0]?.messages[1]?.content).toContain('(none)');
  });

  it('treats a missing content file as lacking the disclaimer', async () => {
    const { r } = await run([
      { filename: 'site/src/content/en/gone.md', status: 'modified', patch: '+x' },
    ]);
    expect(r.report.reasons).toContain('missing disclaimer: site/src/content/en/gone.md');
  });

  it('caps the text sent to the model and lists what was not reviewed', async () => {
    const big = `+${'a'.repeat(5000)}`;
    const files = ['a', 'b', 'c', 'd'].map((n) => ({
      filename: `data/${n}.md`,
      status: 'modified',
      patch: big,
    }));
    const { llm } = await run(files);
    const sent = llm.requests[0]?.messages[1]?.content ?? '';
    expect(sent).toContain('### data/d.md\n(not reviewed: text limit reached');
    expect(sent.length).toBeLessThan(14_000);
  });
});

describe('main()', () => {
  it('fails the run without a PR number', async () => {
    const r = await main(testRunOptions('verifier'), ['verifier']);
    expect(r.status).toBe('error');
    expect(r.error).toContain('--pr <n>');
  });

  it('runs end to end in dry-run and exits ok', async () => {
    const github = gh();
    const r = await main(
      testRunOptions('verifier', { env: { ...KEYS }, github, llm: scriptedLlm() }),
      ['verifier', '--pr', '12'],
      {
        reader: reader({}, [{ filename: 'tools-core/src/emi.ts', status: 'modified' }]),
      },
    );
    expect(r.status).toBe('ok');
    expect(statuses(github)[0]?.state).toBe('success');
  });

  it('skips cleanly with no token (local dry run)', async () => {
    const r = await main(
      testRunOptions('verifier', { env: { DRY_RUN: 'true', PR_NUMBER: '4' } }),
      [],
    );
    expect(r).toMatchObject({
      status: 'ok',
      result: { skipped: expect.stringContaining('PR #4') },
    });
  });

  it('builds the REST reader when a token is set', async () => {
    const r = await main(
      testRunOptions('verifier', {
        env: { DRY_RUN: 'true', GITHUB_TOKEN: 'ghs_test', GITHUB_REPOSITORY: 'o/r' },
        fetch: async () => new Response('{"message":"Bad credentials"}', { status: 401 }),
      }),
      ['--pr', '5'],
    );
    expect(r.status).toBe('error');
    expect(r.error).toContain('401');
  });

  it('errors when prompt.md lacks a section', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verifier-'));
    mkdirSync(join(root, 'agents', 'verifier'), { recursive: true });
    writeFileSync(join(root, 'agents', 'verifier', 'prompt.md'), '## formula-system\nx\n');
    const ctx = testContext('verifier', {
      github: gh(),
      llm: scriptedLlm(),
      env: KEYS,
      repoRoot: root,
    });
    await expect(
      verify(ctx, 12, {
        reader: reader({}, [{ filename: 'tools-core/src/emi.ts', status: 'modified' }]),
        readRepoFile: () => '{"cases":[{"principal":1,"annualRatePercent":1,"tenureMonths":1}]}',
      }),
    ).rejects.toThrow('missing "## formula-user"');
  });
});
