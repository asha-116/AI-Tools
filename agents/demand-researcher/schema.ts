// zod schema of the Demand Researcher model output (mirrors PROCEDURE.md "Output schema").
// `total` is recomputed by code (src/ideas.ts totalScore); evidence URLs are kept only when
// they are among the URLs the agent actually fetched.

import { z } from 'zod';

const Score = z.number().int().min(1).max(5);

export const IdeaSchema = z.object({
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(20).max(800),
  evidence: z
    .array(z.object({ url: z.url(), note: z.string().trim().max(300).default('') }))
    .min(1)
    .max(10),
  scores: z.object({ demand: Score, effort: Score, uniqueness: Score }),
  total: z.number().optional(),
  free_or_paid: z.enum(['free', 'paid']),
  languages: z.array(z.enum(['en', 'hi'])).min(1),
});

export const IdeasSchema = z.object({ ideas: z.array(IdeaSchema).max(8) });

export type Idea = z.infer<typeof IdeaSchema>;
export type Ideas = z.infer<typeof IdeasSchema>;
