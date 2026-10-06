// zod schemas for the Support agent. Mirrors "Output schema" in PROCEDURE.md.

import { z } from 'zod';
import { CATEGORIES } from './src/kb.js';

/** What the LLM returns for one (redacted) message. */
export const ClassificationSchema = z.object({
  category: z.enum(CATEGORIES),
  confidence: z.number().min(0).max(1),
  /** One English sentence, no personal data; used only in a redacted bug Issue. */
  summary: z.string().max(300).default(''),
});
export type Classification = z.infer<typeof ClassificationSchema>;

/** One log record per message (PROCEDURE.md). Never contains message or reply text. */
export const HandledSchema = z.object({
  message_ref: z.string(),
  category: z.enum(CATEGORIES),
  language: z.enum(['en', 'hi']),
  classifier: z.enum(['llm', 'keywords']),
  kb_article: z.string().nullable(),
  template: z.string().nullable(),
  refund: z.object({
    eligible: z.boolean().nullable(),
    amount_inr: z.number().nullable(),
  }),
  action: z.enum(['reply', 'refund_and_reply', 'escalate']),
  outcome: z.enum([
    'replied',
    'would_reply',
    'held_unapproved_template',
    'escalated',
    'escalated_and_replied',
    'escalated_would_reply',
  ]),
  confidence: z.number(),
});
export type Handled = z.infer<typeof HandledSchema>;
