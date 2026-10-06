// Types for summary.mjs (plain JS so actions/github-script can import it without a build).

export declare const MARKER: string;

export interface QaCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  details: string;
}

/** agents/qa/PROCEDURE.md output schema. */
export interface QaReport {
  pr: number;
  checks: QaCheck[];
  overall: 'pass' | 'fail';
}

export type Needs = Record<string, { result?: string; outputs?: Record<string, string> }>;

export declare function buildReport(needs: Needs, pr: number): QaReport;

export declare function renderComment(
  report: QaReport,
  run: { runUrl: string; sha: string },
): string;

export interface CommentTarget {
  owner: string;
  repo: string;
  issue_number: number;
}

export declare function upsertComment(
  github: unknown,
  target: CommentTarget,
  body: string,
): Promise<'created' | 'updated'>;
