// Classification of a REDACTED message: LLM (schema-validated) with a deterministic keyword
// fallback, plus deterministic language / product / refund-reason / legal-threat detection.

import {
  chatJson,
  containsPii,
  Escalation,
  LlmUnavailable,
  promptSections,
  renderTemplate,
  type AgentContext,
} from '../../lib/src/index.js';
import { ClassificationSchema, type Classification } from '../schema.js';
import type { Category, Language } from './kb.js';

/** Below this the agent does not reply; the owner does (PROCEDURE.md escalation rule). */
export const MIN_CONFIDENCE = 0.8;
/** Confidence given to a single clear keyword match. */
export const KEYWORD_CONFIDENCE = 0.85;
/** Characters of redacted text sent to the model. */
export const MAX_PROMPT_CHARS = 3000;

const DEVANAGARI = /[ऀ-ॿ]/g;
const LETTERS = /\p{L}/gu;
const HINGLISH =
  /\b(hai|hain|nahi|nahin|nhi|kya|kaise|kaisa|kab|kyun|kyon|mera|meri|mere|mujhe|mujhko|paisa|paise|wapas|vapas|chahiye|kripya|karo|karna|kijiye|dijiye|bhai|hua|hui|raha|rahi|abhi|bhej|bhejo|aap|aapka|apna|tha|thi)\b/gi;

/** 'hi' for Devanagari or Hinglish (≥ 2 distinct Hindi words in Latin script), else 'en'. */
export function detectLanguage(text: string): Language {
  const letters = (text.match(LETTERS) ?? []).length;
  const deva = (text.match(DEVANAGARI) ?? []).length;
  if (letters > 0 && deva / letters >= 0.2) return 'hi';
  const words = new Set((text.match(HINGLISH) ?? []).map((w) => w.toLowerCase()));
  return words.size >= 2 ? 'hi' : 'en';
}

// Checked in this order: the first match wins ("link not working, refund please" is a refund).
const KEYWORDS: [Exclude<Category, 'other'>, RegExp][] = [
  [
    'refund_request',
    /refund|money back|return (?:my|the) money|pais[ae] (?:wapas|vapas)|charged twice|double charge|deducted twice|do baar|रिफ़ंड|रिफंड|पैसे वापस|पैसा वापस|दो बार/i,
  ],
  [
    'download_issue',
    /download|\blink\b|expired?|not received|did ?n[o']t (?:get|receive)|file nahi|डाउनलोड|लिंक|फ़ाइल नहीं|फाइल नहीं|फ़ाइल नहीं मिली/i,
  ],
  [
    'bug',
    /\berror\b|\bbug\b|#ref|#value|#n\/a|#div|#name\?|wrong (?:total|result|amount)|not calculating|formula (?:is )?(?:wrong|broken|not working)|galat|गलत|ग़लत|crash/i,
  ],
  [
    'how_to',
    /how (?:do|to|can|should)|kaise|कैसे|import|google sheets?|excel|set ?up|guide|instructions?|column|कॉलम|शीट/i,
  ],
];

/** Deterministic fallback: first matching category, or `other` with confidence 0. */
export function keywordClassify(text: string): Classification {
  for (const [category, re] of KEYWORDS) {
    if (re.test(text)) return { category, confidence: KEYWORD_CONFIDENCE, summary: '' };
  }
  return { category: 'other', confidence: 0, summary: '' };
}

const LEGAL =
  /chargeback|charge back|consumer (?:court|forum)|legal notice|lawyer|advocate|police|cyber ?cell|\bfraud\b|\bscam\b|उपभोक्ता|वकील|पुलिस|धोखा|कानूनी|क़ानूनी/i;

/** Legal threats, chargebacks, fraud claims: always the owner (PROCEDURE.md). */
export function isLegalThreat(text: string): boolean {
  return LEGAL.test(text);
}

/** products/catalog.json id named in the message; undefined when none or more than one. */
export function detectProduct(text: string): string | undefined {
  const lead = /\blead|लीड|follow.?up|enquir/i.test(text);
  const ledger = /commission|कमीशन|ledger|लेजर|brokerage/i.test(text);
  if (/bundle|बंडल/i.test(text) || lead === ledger) return undefined;
  return lead ? 'lead-tracker' : 'commission-ledger';
}

export type RefundReason = 'double_charge' | 'broken_link' | 'changed_mind';

/** Which refund-policy case the buyer describes (keywords, deterministic). */
export function detectRefundReason(text: string): RefundReason {
  if (/twice|double|two times|2 times|do baar|दो बार|deducted (?:2|two)/i.test(text))
    return 'double_charge';
  if (/download|\blink\b|not (?:open|work)|expired?|डाउनलोड|लिंक|खुल नहीं/i.test(text))
    return 'broken_link';
  return 'changed_mind';
}

/** Links can carry download tokens (bearer credentials): never send them to a model. */
export function stripLinks(text: string): string {
  return text.replace(/\bhttps?:\/\/\S+/gi, '[LINK]').replace(/\bwww\.\S+/gi, '[LINK]');
}

export interface ClassifyResult extends Classification {
  classifier: 'llm' | 'keywords';
}

/**
 * Classify redacted text. Throws if the text still contains PII (redaction must run first).
 * No provider configured → keyword fallback (and `state.llmAvailable` is cleared for the run).
 * Invalid output twice → the lib Escalation is filed as an Issue and the keyword result is used.
 */
export async function classify(
  ctx: AgentContext,
  redacted: string,
  state: { llmAvailable: boolean },
): Promise<ClassifyResult> {
  if (containsPii(redacted)) throw new Error('classify: text is not redacted');
  const fallback = (): ClassifyResult => ({ ...keywordClassify(redacted), classifier: 'keywords' });
  if (!state.llmAvailable) return fallback();
  const p = promptSections(ctx.readFile('prompt.md'));
  try {
    const { data } = await chatJson(
      ctx.llm,
      {
        messages: [
          { role: 'system', content: p.system as string },
          {
            role: 'user',
            content: renderTemplate(p.user as string, {
              message: redacted.slice(0, MAX_PROMPT_CHARS),
            }),
          },
        ],
        temperature: 0,
        maxTokens: 200,
      },
      ClassificationSchema,
      'support classification',
    );
    return { ...data, classifier: 'llm' };
  } catch (e) {
    if (e instanceof LlmUnavailable) {
      state.llmAvailable = false;
      ctx.log.warn('llm.unavailable', { fallback: 'keywords' });
      return fallback();
    }
    if (e instanceof Escalation) {
      await ctx.escalate(e.request);
      return fallback();
    }
    throw e;
  }
}
