import { describe, expect, it } from 'vitest';
import { LlmUnavailable } from '../../lib/src/index.js';
import { fakeLlm, MemoryGitHub, testContext } from '../../lib/src/testing.js';
import {
  classify,
  detectLanguage,
  detectProduct,
  detectRefundReason,
  isLegalThreat,
  keywordClassify,
  KEYWORD_CONFIDENCE,
  MAX_PROMPT_CHARS,
  stripLinks,
} from '../src/classify.js';

describe('detectLanguage', () => {
  it.each([
    ['नमस्ते, मेरा डाउनलोड लिंक काम नहीं कर रहा', 'hi'],
    ['Bhai link kaam nahi kar raha, kya karu?', 'hi'],
    ['Mera payment ho gaya hai', 'hi'],
    ['My download link has expired', 'en'],
    ['Hai, the link is broken', 'en'], // one Hinglish-looking word is not enough
    ['', 'en'],
    ['Lead tracker चाहिए please help', 'hi'],
  ])('%s → %s', (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });
});

describe('keywordClassify (fallback without an LLM)', () => {
  it.each([
    ['I want a refund please', 'refund_request'],
    ['Download link not working, refund please', 'refund_request'],
    ['I was charged twice for one order', 'refund_request'],
    ['paise wapas chahiye', 'refund_request'],
    ['मुझे रिफंड चाहिए', 'refund_request'],
    ['My download link expired', 'download_issue'],
    ['I did not receive the file', 'download_issue'],
    ['डाउनलोड नहीं हो रहा', 'download_issue'],
    ['The Pending column shows #REF!', 'bug'],
    ['Total galat aa raha hai', 'bug'],
    ['How do I import this into Google Sheets?', 'how_to'],
    ['lead tracker kaise use karu', 'how_to'],
    ['शीट कैसे खोलें', 'how_to'],
    ['Do you build websites?', 'other'],
  ])('%s → %s', (text, category) => {
    const r = keywordClassify(text);
    expect(r.category).toBe(category);
    expect(r.confidence).toBe(category === 'other' ? 0 : KEYWORD_CONFIDENCE);
  });
});

describe('deterministic detectors', () => {
  it('detects the product', () => {
    expect(detectProduct('lead tracker question')).toBe('lead-tracker');
    expect(detectProduct('लीड ट्रैकर')).toBe('lead-tracker');
    expect(detectProduct('commission ledger')).toBe('commission-ledger');
    expect(detectProduct('कमीशन')).toBe('commission-ledger');
    expect(detectProduct('lead tracker and commission ledger')).toBeUndefined();
    expect(detectProduct('the bundle with lead tracker')).toBeUndefined();
    expect(detectProduct('a template')).toBeUndefined();
  });

  it('detects the refund-policy case', () => {
    expect(detectRefundReason('charged twice')).toBe('double_charge');
    expect(detectRefundReason('पैसे दो बार कटे')).toBe('double_charge');
    expect(detectRefundReason('link does not work, refund')).toBe('broken_link');
    expect(detectRefundReason('मुझे पसंद नहीं आया')).toBe('changed_mind');
  });

  it('flags legal threats and chargebacks', () => {
    expect(isLegalThreat('I will file a chargeback')).toBe(true);
    expect(isLegalThreat('consumer court')).toBe(true);
    expect(isLegalThreat('मैं वकील से बात करूँगा')).toBe(true);
    expect(isLegalThreat('please help with the download')).toBe(false);
  });

  it('removes links (download tokens are credentials)', () => {
    expect(stripLinks('see https://dl.example.com/d/abc.def and www.example.com/x ok')).toBe(
      'see [LINK] and [LINK] ok',
    );
  });
});

describe('classify', () => {
  const GOOD = '{"category":"how_to","confidence":0.93,"summary":"Asks how to import."}';

  it('uses the LLM with the redacted text only and validates the reply', async () => {
    const llm = fakeLlm([GOOD]);
    const state = { llmAvailable: true };
    const r = await classify(testContext('support', { llm }), 'How to import? [EMAIL_1]', state);
    expect(r).toEqual({
      category: 'how_to',
      confidence: 0.93,
      summary: 'Asks how to import.',
      classifier: 'llm',
    });
    const req = llm.requests[0];
    expect(req?.messages[0]?.content).toContain('download_issue');
    expect(req?.messages[1]?.content).toContain('How to import? [EMAIL_1]');
    expect(req?.jsonMode).toBe(true);
  });

  it('truncates long messages', async () => {
    const llm = fakeLlm([GOOD]);
    await classify(testContext('support', { llm }), 'x '.repeat(5000), { llmAvailable: true });
    expect(llm.requests[0]?.messages[1]?.content.length).toBeLessThan(MAX_PROMPT_CHARS + 200);
  });

  it('refuses text that still contains PII', async () => {
    const llm = fakeLlm([GOOD]);
    await expect(
      classify(testContext('support', { llm }), 'mail me at a.b@example.com', {
        llmAvailable: true,
      }),
    ).rejects.toThrow(/not redacted/);
    expect(llm.requests).toHaveLength(0);
  });

  it('falls back to keywords when no provider is configured, for the rest of the run', async () => {
    const llm = fakeLlm([new LlmUnavailable([])]);
    const ctx = testContext('support', { llm });
    const state = { llmAvailable: true };
    expect(await classify(ctx, 'refund please', state)).toEqual({
      category: 'refund_request',
      confidence: KEYWORD_CONFIDENCE,
      summary: '',
      classifier: 'keywords',
    });
    expect(state.llmAvailable).toBe(false);
    await classify(ctx, 'download link expired', state);
    expect(llm.requests).toHaveLength(1);
  });

  it('invalid output twice → needs-owner Issue, then keyword fallback', async () => {
    const github = new MemoryGitHub({ agent: 'support' });
    const llm = fakeLlm(['{"category":"nope"}', 'not json']);
    const r = await classify(testContext('support', { llm, github }), 'link expired', {
      llmAvailable: true,
    });
    expect(r.classifier).toBe('keywords');
    expect(r.category).toBe('download_issue');
    expect(github.issues[0]?.labels).toContain('needs-owner');
    expect(github.issues[0]?.title).toMatch(/Invalid support classification/);
  });

  it('rethrows unexpected errors', async () => {
    const llm = fakeLlm([new Error('boom')]);
    await expect(
      classify(testContext('support', { llm }), 'x', { llmAvailable: true }),
    ).rejects.toThrow('boom');
  });
});
