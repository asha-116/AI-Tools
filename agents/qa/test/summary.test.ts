import { describe, expect, it, vi } from 'vitest';
import { MARKER, buildReport, renderComment, upsertComment } from '../src/summary.mjs';

const allSteps = {
  install: 'success',
  lint: 'success',
  format: 'success',
  typecheck: 'success',
  site_check: 'success',
  bilingual: 'success',
  tests: 'success',
  build: 'success',
  pages: 'success',
  structure: 'success',
};

const greenNeeds = {
  checks: { result: 'success', outputs: allSteps },
  lighthouse: { result: 'success', outputs: {} },
  secrets: { result: 'success', outputs: {} },
  links: { result: 'success', outputs: {} },
};

describe('buildReport', () => {
  it('maps every step and job to pass/fail/skip, in the PROCEDURE.md output schema', () => {
    const report = buildReport(greenNeeds, 12);
    expect(report.pr).toBe(12);
    expect(report.overall).toBe('pass');
    expect(report.checks.map((c) => c.name)).toEqual([
      'Install',
      'Lint',
      'Format',
      'Typecheck',
      'Astro check',
      'Bilingual strings',
      'Unit tests + coverage',
      'Build site',
      'Pages: disclaimer, formula, templates',
      'Repo structure',
      'Lighthouse (mobile ≥ 90)',
      'Secret scan',
      'Link check (offline)',
    ]);
    expect(report.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('marks failures, explains skips and fails overall', () => {
    const report = buildReport(
      {
        ...greenNeeds,
        checks: {
          result: 'failure',
          outputs: { ...allSteps, bilingual: 'failure', build: 'failure', pages: 'skipped' },
        },
        lighthouse: { result: 'cancelled', outputs: {} },
      },
      3,
    );
    expect(report.overall).toBe('fail');
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
    expect(byName['Bilingual strings']?.status).toBe('fail');
    expect(byName['Pages: disclaimer, formula, templates']).toMatchObject({
      status: 'skip',
      details: 'did not run (an earlier step failed)',
    });
    expect(byName['Lighthouse (mobile ≥ 90)']).toMatchObject({
      status: 'skip',
      details: 'cancelled',
    });
  });

  it('reports a failed job whose steps did not report (e.g. checkout failed)', () => {
    const report = buildReport({ ...greenNeeds, checks: { result: 'failure', outputs: {} } }, 1);
    expect(report.overall).toBe('fail');
    expect(report.checks).toContainEqual({
      name: 'CI checks job',
      status: 'fail',
      details: 'the job failed before its checks could report — open the run log',
    });
    expect(report.checks.find((c) => c.name === 'Lint')).toMatchObject({
      status: 'skip',
      details: 'did not run',
    });
  });
});

describe('renderComment', () => {
  it('starts with the marker and lists every check', () => {
    const body = renderComment(buildReport(greenNeeds, 7), {
      runUrl: 'https://example.com/run/1',
      sha: '0123456789abcdef',
    });
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('QA summary: all checks passed');
    expect(body).toContain('| Bilingual strings | PASS |');
    expect(body).toContain('`0123456`');
    expect(body).toContain('[workflow run](https://example.com/run/1)');
    expect(body).toContain('"overall": "pass"');
  });

  it('counts failures in the title', () => {
    const report = buildReport({ ...greenNeeds, links: { result: 'failure', outputs: {} } }, 7);
    expect(renderComment(report, { runUrl: 'u', sha: 's' })).toContain(
      'QA summary: 1 check failed',
    );
  });
});

describe('upsertComment', () => {
  const target = { owner: 'o', repo: 'r', issue_number: 5 };

  function fakeGithub(existing: { id: number; body: string; user: { type: string } }[]) {
    const listComments = vi.fn();
    const createComment = vi.fn(async () => ({}));
    const updateComment = vi.fn(async () => ({}));
    return {
      github: {
        paginate: vi.fn(async () => existing),
        rest: { issues: { listComments, createComment, updateComment } },
      },
      createComment,
      updateComment,
    };
  }

  it('creates the comment when none exists', async () => {
    const f = fakeGithub([{ id: 1, body: 'hello', user: { type: 'User' } }]);
    expect(await upsertComment(f.github, target, `${MARKER}\nbody`)).toBe('created');
    expect(f.createComment).toHaveBeenCalledWith({ ...target, body: `${MARKER}\nbody` });
    expect(f.updateComment).not.toHaveBeenCalled();
  });

  it('updates the bot comment that carries the marker (never a human one)', async () => {
    const f = fakeGithub([
      { id: 1, body: `${MARKER} quoted by a human`, user: { type: 'User' } },
      { id: 2, body: `${MARKER}\nold`, user: { type: 'Bot' } },
    ]);
    expect(await upsertComment(f.github, target, `${MARKER}\nnew`)).toBe('updated');
    expect(f.updateComment).toHaveBeenCalledWith({
      owner: 'o',
      repo: 'r',
      comment_id: 2,
      body: `${MARKER}\nnew`,
    });
    expect(f.createComment).not.toHaveBeenCalled();
  });
});
