// zod schema for the Builder's LLM output: a plan + known-answer cases drafted from the Issue.
// `planSchemaFor(urls)` adds the hard rule that every case cites a URL that appears in the Issue,
// so an invalid answer is retried once with the error (lib/schema.ts) and then escalated.

import { z } from 'zod';

const identifier = z.string().regex(/^[a-z][A-Za-z0-9]{0,40}$/, 'camelCase identifier');
const finite = z.number().refine((n) => Number.isFinite(n), 'must be a finite number');

export const BuilderPlanSchema = z.object({
  function_name: z.string().regex(/^[a-z][A-Za-z0-9]{2,40}$/, 'camelCase function name'),
  slug: z
    .string()
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case slug'),
  title: z.string().min(1).max(120),
  formula_description: z.string().min(20).max(3000),
  inputs: z
    .array(
      z.object({ name: identifier, description: z.string().max(300), unit: z.string().max(40) }),
    )
    .min(1)
    .max(15),
  outputs: z
    .array(
      z.object({ name: identifier, description: z.string().max(300), unit: z.string().max(40) }),
    )
    .min(1)
    .max(15),
  assumptions: z.array(z.string().max(300)).max(15),
  cases: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        input: z.record(z.string(), z.union([finite, z.string().max(80), z.boolean()])),
        expect: z.record(z.string(), finite),
        quote: z.string().min(1).max(600),
        source: z.string().url(),
      }),
    )
    .max(30),
  sources_disagree: z.boolean(),
  needs_pricing_or_legal: z.boolean(),
  notes: z.string().max(1000).default(''),
});
export type BuilderPlan = z.infer<typeof BuilderPlanSchema>;

/** The plan schema plus: sources must come from the Issue; case keys must match inputs/outputs. */
export function planSchemaFor(issueUrls: readonly string[]) {
  const allowed = new Set(issueUrls);
  return BuilderPlanSchema.superRefine((plan, ctx) => {
    const inputs = new Set(plan.inputs.map((i) => i.name));
    const outputs = new Set(plan.outputs.map((o) => o.name));
    plan.cases.forEach((c, i) => {
      if (!allowed.has(c.source)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cases', i, 'source'],
          message: `source "${c.source}" is not a URL cited in the Issue`,
        });
      }
      for (const k of Object.keys(c.input)) {
        if (!inputs.has(k)) {
          ctx.addIssue({
            code: 'custom',
            path: ['cases', i, 'input', k],
            message: `unknown input "${k}"`,
          });
        }
      }
      for (const k of Object.keys(c.expect)) {
        if (!outputs.has(k)) {
          ctx.addIssue({
            code: 'custom',
            path: ['cases', i, 'expect', k],
            message: `unknown output "${k}"`,
          });
        }
      }
    });
  });
}
