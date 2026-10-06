import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { addLlmLog, collectLlmTokens, emptySummary } from '../src/llm-logs.mjs';

const line = (o: unknown) => JSON.stringify(o);

describe('addLlmLog', () => {
  it('sums prompt/completion per agent for the month and tolerates format variants', () => {
    const text = [
      line({
        evt: 'llm',
        agent: 'builder',
        ts: '2026-09-02T10:00:00Z',
        usage: { prompt: 100, completion: 20 },
      }),
      line({
        evt: 'llm',
        agent: 'builder',
        ts: '2026-09-03T10:00:00Z',
        usage: { prompt_tokens: 50, completion_tokens: 5 },
      }),
      line({
        event: 'llm',
        agent: 'qa',
        time: '2026-09-04',
        usage: { input_tokens: '7', output_tokens: 3 },
      }),
      line({
        type: 'llm',
        agent: 'qa',
        timestamp: Date.parse('2026-09-05T00:00:00Z'),
        usage: { input: 1, output: 1 },
      }),
      line({ evt: 'llm', ts: '2026-09-06', usage: { prompt: -5, completion: 'x' } }),
      line({ evt: 'llm', agent: '  ', ts: '2026-09-06' }),
      line({ evt: 'llm', agent: 'qa', ts: '2026-08-31T23:59:59Z', usage: { prompt: 999 } }),
      line({ evt: 'run_start', agent: 'qa', ts: '2026-09-06' }),
      line({ evt: 'llm', agent: 'qa', usage: { prompt: 1 } }),
      '',
      '{not json',
      line([1, 2]),
      line(null),
    ].join('\n');
    const s = addLlmLog(text, { month: '2026-09', path: 'qa/run.jsonl' });
    expect(s).toEqual({
      agents: [
        { agent: 'builder', calls: 2, prompt: 150, completion: 25 },
        { agent: 'qa', calls: 2, prompt: 8, completion: 4 },
        { agent: 'unknown', calls: 2, prompt: 0, completion: 0 },
      ],
      files: 1,
      undated: 1,
      malformed: 3,
    });
  });

  it('dates lines without a timestamp from the file path and accumulates across files', () => {
    const a = addLlmLog(line({ evt: 'llm', agent: 'qa', usage: { prompt: 1, completion: 2 } }), {
      month: '2026-09',
      path: 'qa/2026-09-14.jsonl',
    });
    const b = addLlmLog(
      line({ evt: 'llm', agent: 'qa', usage: { prompt: 10, completion: 20 } }),
      {
        month: '2026-09',
        path: '2026-09/qa.jsonl',
      },
      a,
    );
    expect(b.agents).toEqual([{ agent: 'qa', calls: 2, prompt: 11, completion: 22 }]);
    expect(b.files).toBe(2);
    // the accumulator passed in is not mutated
    expect(a.agents[0].calls).toBe(1);
    expect(addLlmLog('', { month: '2026-09' })).toEqual({ ...emptySummary(), files: 1 });
  });
});

describe('collectLlmTokens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-logs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads *.jsonl recursively and ignores other files', async () => {
    mkdirSync(join(dir, 'builder', '2026-09'), { recursive: true });
    writeFileSync(
      join(dir, 'builder', '2026-09', 'run-1.jsonl'),
      line({ evt: 'llm', agent: 'builder', usage: { prompt: 3, completion: 4 } }) + '\n',
    );
    writeFileSync(join(dir, 'notes.txt'), line({ evt: 'llm', agent: 'x', ts: '2026-09-01' }));
    const s = await collectLlmTokens(dir, '2026-09');
    expect(s.agents).toEqual([{ agent: 'builder', calls: 1, prompt: 3, completion: 4 }]);
    expect(s.files).toBe(1);
  });

  it('returns an empty summary when the directory does not exist', async () => {
    expect(await collectLlmTokens(join(dir, 'missing'), '2026-09')).toEqual(emptySummary());
  });

  it('rethrows other filesystem errors', async () => {
    writeFileSync(join(dir, 'file'), 'x');
    await expect(collectLlmTokens(join(dir, 'file'), '2026-09')).rejects.toThrow();
  });
});
