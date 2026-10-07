// The money disclaimer comes from company/policies/disclaimers.md — never written by a model.

import type { Bilingual } from './tools.js';

/** Short line required on every calculator and money post (AGENTS.md rule 7). */
export const SHORT_DISCLAIMER: Bilingual = {
  en: 'For estimation only — verify with a professional.',
  hi: 'केवल अनुमान के लिए — किसी विशेषज्ञ से पुष्टि करें।',
};

/**
 * Parse the `**EN:**` and `**HI:**` paragraphs of disclaimers.md and fill {last_verified}.
 * Throws when either is missing so a policy edit cannot silently drop the disclaimer.
 */
export function parseDisclaimers(markdown: string, lastVerified: string): Bilingual {
  const para = (label: string): string => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?:\\n\\s*\\n|$)`);
    const m = re.exec(markdown);
    if (!m?.[1]?.trim()) throw new Error(`disclaimers.md has no **${label}:** paragraph`);
    return m[1]
      .replace(/\s*\n\s*/g, ' ')
      .trim()
      .replaceAll('{last_verified}', lastVerified);
  };
  const out = { en: para('EN'), hi: para('HI') };
  if (!out.en.includes(SHORT_DISCLAIMER.en)) {
    throw new Error('disclaimers.md EN text must contain the AGENTS.md rule 7 note');
  }
  return out;
}
