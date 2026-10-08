import { describe, expect, it } from 'vitest';
import { CandidateSchema, DraftSchema, OutputSchema, type Candidate } from '../schema.js';
import { candidate } from './helpers.js';
import {
  issueBody,
  rankTasks,
  score,
  stateTasks,
  taskLabels,
  TASK_MARKER,
  toIssue,
  toTask,
  type Task,
} from '../src/tasks.js';

describe('schemas', () => {
  it('validates PROCEDURE output and candidates', () => {
    expect(CandidateSchema.parse({ ...candidate(), needs_owner: undefined }).needs_owner).toBe(
      false,
    );
    expect(() => CandidateSchema.parse(candidate({ title: 'x'.repeat(81) }))).toThrow();
    expect(() => CandidateSchema.parse(candidate({ token_budget: 20_001 }))).toThrow();
    expect(() => CandidateSchema.parse({ ...candidate(), agent: 'orchestrator' })).toThrow();
    expect(() => CandidateSchema.parse({ ...candidate(), agent: 'controller' })).toThrow();
    expect(() => DraftSchema.parse({ candidates: Array(9).fill(candidate()) })).toThrow();
    const issue = toIssue(toTask(candidate(), 'llm'));
    expect(() =>
      OutputSchema.parse({
        date: '2026-10-06',
        issues: Array(6).fill(issue),
        report_markdown: 'r',
      }),
    ).toThrow();
    expect(
      OutputSchema.parse({ date: '2026-10-06', issues: [issue], report_markdown: 'r' }),
    ).toBeTruthy();
  });
});

describe('assignee', () => {
  it('keeps calculator/template work with the Builder and sends the rest to the engineer', () => {
    expect(toTask(candidate({ agent: 'builder', type: 'tool' }), 'llm').agent).toBe('builder');
    expect(toTask(candidate({ agent: 'builder', type: 'product' }), 'llm').agent).toBe('builder');
    const infra = toTask(candidate({ agent: 'builder', type: 'infra' }), 'llm');
    expect(infra.agent).toBe('engineer');
    expect(infra.labels[0]).toBe('agent:engineer');
    expect(
      stateTasks({
        failing: [],
        staleData: [{ path: 'data/x.json', last_verified: '2026-01-01', days: 280 }],
      })[0]?.agent,
    ).toBe('engineer');
  });
});

describe('labels', () => {
  it('has one agent and one type label, priority unless normal, needs-owner when flagged', () => {
    expect(taskLabels(candidate())).toEqual(['agent:engineer', 'type:content']);
    expect(taskLabels(candidate({ priority: 'high', needs_owner: true }))).toEqual([
      'agent:engineer',
      'type:content',
      'priority:high',
      'needs-owner',
    ]);
    expect(taskLabels(candidate({ priority: 'low' }))).toContain('priority:low');
  });
});

describe('rankTasks', () => {
  const t = (title: string, over: Partial<Candidate>, source: Task['source'] = 'llm') =>
    toTask(candidate({ title, ...over }), source);

  it('sorts by impact ÷ effort, then priority, then state first, then title; caps at 5', () => {
    const tasks = [
      t('b low ratio', { impact: 1, effort: 5 }),
      t('a top', { impact: 5, effort: 1 }),
      t('c tie normal', { impact: 2, effort: 2 }),
      t('d tie high', { impact: 3, effort: 3, priority: 'high' }),
      t('e tie state', { impact: 1, effort: 1 }, 'state'),
      t('f tie title', { impact: 4, effort: 4 }),
      t('g extra', { impact: 1, effort: 4 }),
    ];
    expect(score(tasks[1] as Task)).toBe(5);
    expect(rankTasks(tasks).map((x) => x.title)).toEqual([
      'a top',
      'd tie high',
      'e tie state',
      'c tie normal',
      'f tie title',
    ]);
    expect(rankTasks(tasks, 0)).toEqual([]);
    expect(rankTasks(tasks, -1)).toEqual([]);
    // state vs llm in both orders
    expect(
      rankTasks([t('x', { impact: 1, effort: 1 }, 'state'), t('y', { impact: 1, effort: 1 })]).map(
        (x) => x.source,
      ),
    ).toEqual(['state', 'llm']);
  });
});

describe('stateTasks', () => {
  it('turns failing workflows and stale data into engineer tasks', () => {
    const out = stateTasks({
      failing: [
        {
          name: 'Deploy',
          path: '.github/workflows/deploy.yml',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://github.com/o/r/actions/runs/1',
          created_at: '2026-10-05T00:00:00Z',
        },
        {
          name: 'X'.repeat(90),
          path: '',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'u',
          created_at: '2026-10-05T00:00:00Z',
        },
      ],
      staleData: [{ path: 'data/stamp-duty/KA.json', last_verified: '2026-01-01', days: 278 }],
    });
    expect(out.map((x) => [x.title.length <= 80, x.type, x.priority, x.source])).toEqual([
      [true, 'infra', 'high', 'state'],
      [true, 'infra', 'high', 'state'],
      [true, 'data', 'normal', 'state'],
    ]);
    expect(out[0]?.title).toBe('Fix failing workflow: Deploy');
    expect(out[1]?.title.endsWith('…')).toBe(true);
    expect(out[1]?.inputs).toEqual(['u', 'X'.repeat(90)]);
    expect(out[2]?.labels).toEqual(['agent:engineer', 'type:data']);
    for (const task of out) expect(() => CandidateSchema.parse(task)).not.toThrow();
  });
});

describe('issueBody', () => {
  it('has the goal, checkboxes, inputs, budget and provenance', () => {
    const body = issueBody(toTask(candidate({ needs_owner: true }), 'llm'), {
      date: '2026-10-06',
      runUrl: 'https://github.com/o/r/actions/runs/9',
    });
    expect(body.startsWith(TASK_MARKER)).toBe(true);
    expect(body).toContain('- [ ] FAQ renders in EN and HI');
    expect(body).toContain('- site/src/tools/emi/');
    expect(body).toContain('**Token budget:** 8,000');
    expect(body).toContain('Needs owner approval');
    expect(body).toContain('([run](https://github.com/o/r/actions/runs/9)) from company/goals.md');

    const plain = issueBody(toTask(candidate({ inputs: [] }), 'state'), { date: '2026-10-06' });
    expect(plain).toContain('- (none)');
    expect(plain).not.toContain('Needs owner approval');
    expect(plain).toContain('on 2026-10-06 from repository state');
  });
});
