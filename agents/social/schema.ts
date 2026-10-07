// zod schema of the Social model output (mirrors PROCEDURE.md "Output schema").
// `slug` and `status` are set by code; status is always "draft" — this agent never posts.

import { z } from 'zod';

export const SocialDraftSchema = z.object({
  script: z.string().trim().min(100).max(1200),
  caption: z.object({
    en: z.string().trim().min(20).max(600),
    hi: z.string().trim().min(20).max(600),
  }),
  pin_text: z.string().trim().min(10).max(100),
  hashtags: z
    .array(
      z
        .string()
        .trim()
        .regex(/^#[\p{L}\p{N}_]{2,30}$/u, 'hashtag must look like #word'),
    )
    .min(3)
    .max(5),
});

export type SocialDraft = z.infer<typeof SocialDraftSchema>;

/** What is committed to company/social-queue/ (PROCEDURE.md output schema). */
export interface SocialPost extends SocialDraft {
  slug: string;
  status: 'draft';
}
