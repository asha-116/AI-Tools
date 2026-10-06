// zod schemas for the Verifier (mirror PROCEDURE.md "Output schema").
//
// - FormulaAnswersSchema: what the verifier LLM returns when it computes sampled cases itself.
// - ClaimsReviewSchema:   what the verifier LLM returns when it reviews changed text.
// - VerifierReportSchema: the agent's own output (posted in the PR comment as JSON).

import { z } from 'zod';

const finite = z.number().refine((n) => Number.isFinite(n), 'must be a finite number');

/** One computed case: `values` maps each requested output field to a number. */
export const FormulaAnswerSchema = z.object({
  id: z.string().min(1),
  values: z.record(z.string(), finite),
});

export const FormulaAnswersSchema = z.object({
  results: z.array(FormulaAnswerSchema),
});
export type FormulaAnswers = z.infer<typeof FormulaAnswersSchema>;

/** The answers must cover every requested case id and field (so a retry can fix omissions). */
export function formulaAnswersFor(requested: readonly { id: string; fields: readonly string[] }[]) {
  return FormulaAnswersSchema.superRefine((data, ctx) => {
    const byId = new Map(data.results.map((r) => [r.id, r.values]));
    for (const want of requested) {
      const values = byId.get(want.id);
      if (!values) {
        ctx.addIssue({ code: 'custom', message: `missing result for case id "${want.id}"` });
        continue;
      }
      for (const f of want.fields) {
        if (!(f in values)) {
          ctx.addIssue({ code: 'custom', message: `case "${want.id}" is missing field "${f}"` });
        }
      }
    }
  });
}

export const ClaimStatusSchema = z.enum(['supported', 'contradicted', 'unsourced', 'unchecked']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ClaimsReviewSchema = z.object({
  claims: z
    .array(
      z.object({
        file: z.string().min(1),
        claim: z.string().min(1).max(500),
        /** Cited URL backing the claim, or "" when none is cited. */
        source: z.string().max(500),
        status: ClaimStatusSchema,
        note: z.string().max(500).default(''),
      }),
    )
    .max(60),
  advice: z
    .array(
      z.object({
        file: z.string().min(1),
        text: z.string().min(1).max(500),
        note: z.string().max(500).default(''),
      }),
    )
    .max(30),
  missing_disclaimer: z
    .array(z.object({ file: z.string().min(1), note: z.string().max(500).default('') }))
    .max(30),
});
export type ClaimsReview = z.infer<typeof ClaimsReviewSchema>;

export const VerifierReportSchema = z.object({
  pr: z.number().int().nonnegative(),
  verifier_model_family: z.string(),
  producer_model_family: z.string(),
  cases: z.array(
    z.object({
      formula: z.string(),
      input: z.record(z.string(), z.unknown()),
      field: z.string(),
      expected_by_verifier: z.number().nullable(),
      actual: z.number().nullable(),
      match: z.boolean(),
      note: z.string(),
    }),
  ),
  claims: z.array(
    z.object({
      file: z.string(),
      claim: z.string(),
      source: z.string(),
      supported: z.boolean(),
      status: ClaimStatusSchema,
      note: z.string(),
    }),
  ),
  verdict: z.enum(['pass', 'fail', 'pending']),
  reasons: z.array(z.string()),
});
export type VerifierReport = z.infer<typeof VerifierReportSchema>;
