import { describe, expect, it } from 'vitest';
import { FAILURE_LABELS, buildFailureAlert, readFailedRun } from '../failure-alert.mjs';

const env = {
  FAILED_WORKFLOW: 'Deploy',
  FAILED_RUN_URL: 'https://github.com/o/r/actions/runs/123',
  FAILED_RUN_NUMBER: '45',
  FAILED_RUN_ATTEMPT: '1',
  FAILED_BRANCH: 'main',
  FAILED_EVENT: 'push',
  FAILED_SHA: 'abcdef1234567890',
  FAILED_CONCLUSION: 'failure',
};
const now = new Date('2026-10-06T08:15:30Z');

describe('readFailedRun', () => {
  it('maps the env vars set by failure-alert.yml, defaulting missing ones', () => {
    expect(readFailedRun(env)).toEqual({
      workflow: 'Deploy',
      runUrl: 'https://github.com/o/r/actions/runs/123',
      runNumber: '45',
      attempt: '1',
      branch: 'main',
      event: 'push',
      sha: 'abcdef1234567890',
      conclusion: 'failure',
    });
    expect(readFailedRun({})).toEqual({
      workflow: '',
      runUrl: '',
      runNumber: '',
      attempt: '',
      branch: '',
      event: '',
      sha: '',
      conclusion: 'failure',
    });
  });
});

describe('buildFailureAlert', () => {
  it('builds one Issue per workflow, keyed by a marker on the workflow name', () => {
    const a = buildFailureAlert(readFailedRun(env), now);
    expect(a.title).toBe('Workflow failed: Deploy');
    expect(a.labels).toEqual(FAILURE_LABELS);
    expect(a.labels).toEqual(expect.arrayContaining(['type:bug', 'needs-owner']));
    expect(a.marker).toBe('<!-- toolshop-alert:workflow-failure:deploy -->');
    expect(a.body.startsWith(a.marker)).toBe(true);
    expect(a.body).toContain('| Run | [run #45](https://github.com/o/r/actions/runs/123) |');
    expect(a.body).toContain('| Trigger | push on `main` at `abcdef1` |');
    expect(a.body).toContain('| Detected | 2026-10-06 08:15 UTC |');
    expect(a.comment).toBe(
      'Failed again: [run #45](https://github.com/o/r/actions/runs/123) — push on `main` at `abcdef1`, 2026-10-06 08:15 UTC.',
    );
    // Same workflow → same marker (dedupe); different workflow → different marker.
    expect(buildFailureAlert({ ...readFailedRun(env), runNumber: '46' }, now).marker).toBe(
      a.marker,
    );
    expect(buildFailureAlert({ ...readFailedRun(env), workflow: 'CI' }, now).marker).not.toBe(
      a.marker,
    );
  });

  it('shows re-run attempts and timed-out conclusions; tolerates missing fields', () => {
    const a = buildFailureAlert(
      {
        workflow: 'Backup',
        runUrl: 'https://github.com/o/r/actions/runs/9',
        attempt: '2',
        conclusion: 'timed_out',
      },
      now,
    );
    expect(a.body).toContain('[run #? (attempt 2)]');
    expect(a.body).toContain('| Result | timed_out |');
    expect(a.body).toContain('| Trigger | ? on `?` at `?` |');
    const b = buildFailureAlert({ workflow: '', runUrl: 'https://x/1', conclusion: '' });
    expect(b.title).toBe('Workflow failed: unknown workflow');
    expect(b.body).toContain('| Result | failure |');
  });

  it('neutralises Markdown/HTML in names and refuses non-https run links', () => {
    const a = buildFailureAlert(
      { workflow: 'Evil | <b>`x`</b>\nname', runUrl: 'https://x/1', branch: 'a|b' },
      now,
    );
    expect(a.title).toBe('Workflow failed: Evil    b  x  /b  name');
    expect(a.body).not.toMatch(/<b>/);
    expect(a.body).toContain('`a b`');
    expect(() => buildFailureAlert({ workflow: 'CI', runUrl: 'javascript:alert(1)' }, now)).toThrow(
      /https/,
    );
    expect(() => buildFailureAlert({ workflow: 'CI', runUrl: 'https://x/1) [y](z' }, now)).toThrow(
      /https/,
    );
  });
});
