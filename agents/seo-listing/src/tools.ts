// What the SEO/Listing and Social agents know about each live tool: its published strings and a
// worked example whose numbers are COMPUTED by the real tools-core function (never by a model).
// A tool without an entry here cannot get articles or posts: the agent escalates instead.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeCommission,
  computeEmi,
  computeStampDuty,
  type StateRates,
} from '../../../tools-core/src/index.js';
import { formatInr, formatInrExact } from '../../../site/src/lib/format.js';
import { commissionStrings } from '../../../site/src/tools/commission/strings.js';
import { emiStrings } from '../../../site/src/tools/emi/strings.js';
import { sdStrings } from '../../../site/src/tools/stamp-duty/strings.js';

export type Lang = 'en' | 'hi';
export const LANGS: readonly Lang[] = ['en', 'hi'];

export type Bilingual = Record<Lang, string>;

/** One input or output of the worked example. `display` is what the article shows. */
export interface ExampleValue {
  key: string;
  label: Bilingual;
  value: number;
  display: Bilingual;
}

export interface WorkedExample {
  inputs: ExampleValue[];
  outputs: ExampleValue[];
  /** Where the input numbers come from (shown under the example). */
  source: Bilingual;
}

export interface ToolText {
  metaTitle: string;
  metaDescription: string;
  h1: string;
  lead: string;
  formula: string[];
  assumptions: string[];
}

export interface ToolInfo {
  slug: string;
  text: Record<Lang, ToolText>;
  /** Every tool is about money today; posts and articles then need the disclaimer line. */
  moneyTopic: boolean;
  /** Page path for a language, e.g. /tools/emi/ or /hi/tools/emi/. */
  path(lang: Lang): string;
  /** Date the rates/formula were last reviewed (for the disclaimer's {last_verified}). */
  lastVerified(repoRoot: string): string;
  /** Computed example, or the reason none can be published. */
  example(repoRoot: string): WorkedExample | { unavailable: string };
}

const money = (key: string, label: Bilingual, value: number, exact = false): ExampleValue => {
  const s = exact ? formatInrExact(value) : formatInr(value);
  return { key, label, value, display: { en: s, hi: s } };
};

const percent = (key: string, label: Bilingual, value: number): ExampleValue => ({
  key,
  label,
  value,
  display: { en: `${value}%`, hi: `${value}%` },
});

const toolPath = (slug: string) => (lang: Lang) =>
  lang === 'en' ? `/tools/${slug}/` : `/hi/tools/${slug}/`;

function readJson<T>(repoRoot: string, path: string): T {
  return JSON.parse(readFileSync(join(repoRoot, path), 'utf8')) as T;
}

function metaReviewed(slug: string) {
  return (repoRoot: string) =>
    readJson<{ lastReviewed: string }>(repoRoot, `site/src/tools/${slug}/meta.json`).lastReviewed;
}

// ---------- EMI ----------

// Inputs from a published known-answer case (tools-core/test/fixtures/emi-known-answers.json):
// ₹10,00,000 at 10.5% for 120 months → EMI ₹13,493, interest ₹6,19,220.
const EMI_INPUT = { principal: 1_000_000, annualRatePercent: 10.5, tenureMonths: 120 };

const emi: ToolInfo = {
  slug: 'emi',
  moneyTopic: true,
  text: {
    en: {
      ...pick(emiStrings.en),
      formula: ['EMI = P × r × (1 + r)ⁿ ÷ ((1 + r)ⁿ − 1)', emiStrings.en.formulaWhere],
    },
    hi: {
      ...pick(emiStrings.hi),
      formula: ['EMI = P × r × (1 + r)ⁿ ÷ ((1 + r)ⁿ − 1)', emiStrings.hi.formulaWhere],
    },
  },
  path: toolPath('emi'),
  lastVerified: metaReviewed('emi'),
  example() {
    const r = computeEmi(EMI_INPUT);
    return {
      inputs: [
        money('principal', { en: 'Loan amount', hi: 'लोन राशि' }, EMI_INPUT.principal),
        percent(
          'rate',
          { en: 'Interest rate (per year)', hi: 'ब्याज दर (सालाना)' },
          EMI_INPUT.annualRatePercent,
        ),
        {
          key: 'tenure',
          label: { en: 'Tenure', hi: 'अवधि' },
          value: EMI_INPUT.tenureMonths,
          display: { en: '120 months (10 years)', hi: '120 महीने (10 साल)' },
        },
      ],
      outputs: [
        money('emi', { en: 'Monthly EMI', hi: 'मासिक EMI' }, r.emi),
        money('interest', { en: 'Total interest', hi: 'कुल ब्याज' }, r.totalInterest),
        money('total', { en: 'Total payment', hi: 'कुल भुगतान' }, r.totalPayment),
        money(
          'first_interest',
          { en: 'Interest in the first EMI', hi: 'पहली EMI में ब्याज' },
          r.firstMonthInterest,
        ),
      ],
      source: {
        en: 'Example inputs; results computed by the same code the calculator uses.',
        hi: 'उदाहरण के इनपुट; नतीजे उसी कोड से निकाले गए हैं जो कैलकुलेटर इस्तेमाल करता है।',
      },
    };
  },
};

// ---------- Commission ----------

const COMMISSION_INPUT = {
  dealValue: 8_000_000,
  commission: { type: 'percent' as const, percent: 2 },
  gstPercent: 18,
  parties: [
    { label: 'Me', percent: 60 },
    { label: 'Co-broker', percent: 40 },
  ],
};

const commission: ToolInfo = {
  slug: 'commission',
  moneyTopic: true,
  text: {
    en: { ...pick(commissionStrings.en), formula: commissionStrings.en.formula },
    hi: { ...pick(commissionStrings.hi), formula: commissionStrings.hi.formula },
  },
  path: toolPath('commission'),
  lastVerified: metaReviewed('commission'),
  example() {
    const r = computeCommission(COMMISSION_INPUT);
    const [me, co] = r.parties;
    return {
      inputs: [
        money('deal', { en: 'Deal value', hi: 'डील वैल्यू' }, COMMISSION_INPUT.dealValue),
        percent('rate', { en: 'Commission rate', hi: 'कमीशन दर' }, 2),
        percent('gst_rate', { en: 'GST on commission', hi: 'कमीशन पर GST' }, 18),
        percent('share_me', { en: 'Your share', hi: 'आपका हिस्सा' }, 60),
        percent('share_co', { en: 'Co-broker’s share', hi: 'को-ब्रोकर का हिस्सा' }, 40),
      ],
      outputs: [
        money('gross', { en: 'Commission (before GST)', hi: 'कमीशन (GST से पहले)' }, r.gross, true),
        money('gst', { en: 'GST', hi: 'GST' }, r.gst, true),
        money(
          'total',
          { en: 'Total payable by client', hi: 'क्लाइंट द्वारा कुल देय' },
          r.totalPayable,
          true,
        ),
        money('me', { en: 'Your share', hi: 'आपका हिस्सा' }, me?.amount ?? 0, true),
        money('co', { en: 'Co-broker’s share', hi: 'को-ब्रोकर का हिस्सा' }, co?.amount ?? 0, true),
      ],
      source: {
        en: 'Example inputs (the GST rate is whatever you enter — ask your CA which applies); results computed by the calculator’s own code.',
        hi: 'उदाहरण के इनपुट (GST दर वही जो आप डालें — कौन-सी लागू है, अपने CA से पूछें); नतीजे कैलकुलेटर के अपने कोड से निकाले गए हैं।',
      },
    };
  },
};

// ---------- Stamp duty ----------

/** Verified state rate files only — draft rates are never published in an article. */
export function verifiedStates(repoRoot: string): StateRates[] {
  const dir = join(repoRoot, 'data/stamp-duty');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[A-Z]{2}\.json$/.test(f))
    .sort()
    .map((f) => readJson<StateRates>(repoRoot, `data/stamp-duty/${f}`))
    .filter((s) => s.status === 'verified');
}

const SD_VALUE = 5_000_000;

const stampDuty: ToolInfo = {
  slug: 'stamp-duty',
  moneyTopic: true,
  text: {
    en: { ...pick(sdStrings.en), formula: sdStrings.en.formula },
    hi: { ...pick(sdStrings.hi), formula: sdStrings.hi.formula },
  },
  path: toolPath('stamp-duty'),
  lastVerified(repoRoot) {
    return verifiedStates(repoRoot)[0]?.last_verified ?? 'not verified';
  },
  example(repoRoot) {
    const state = verifiedStates(repoRoot)[0];
    if (!state) {
      return {
        unavailable:
          'No state in data/stamp-duty/ has status "verified". Articles must not publish draft rates.',
      };
    }
    const area = state.areas?.[0]?.id;
    const r = computeStampDuty(state, {
      value: SD_VALUE,
      buyer: 'male',
      ...(area ? { area } : {}),
    });
    const name = { en: state.state, hi: state.state_name_hi ?? state.state };
    return {
      inputs: [
        money('value', { en: 'Property value', hi: 'प्रॉपर्टी की कीमत' }, SD_VALUE),
        {
          key: 'state',
          label: { en: 'State', hi: 'राज्य' },
          value: 0,
          display: name,
        },
      ],
      outputs: [
        money('stamp_duty', { en: 'Stamp duty', hi: 'स्टांप ड्यूटी' }, r.stampDuty),
        money('surcharges', { en: 'Surcharges', hi: 'सरचार्ज' }, r.surchargesTotal),
        money('registration', { en: 'Registration fee', hi: 'रजिस्ट्रेशन फीस' }, r.registration),
        money('total', { en: 'Total to government', hi: 'सरकार को कुल' }, r.total),
      ],
      source: {
        en: `Rates from data/stamp-duty/${state.state_code}.json, last checked ${state.last_verified}; rule: ${r.ruleDescription}.`,
        hi: `दरें data/stamp-duty/${state.state_code}.json से, अंतिम जाँच ${state.last_verified}; नियम: ${r.ruleDescriptionHi ?? r.ruleDescription}।`,
      },
    };
  },
};

function pick(s: {
  metaTitle: string;
  metaDescription: string;
  h1: string;
  lead: string;
  assumptions: string[];
}): Omit<ToolText, 'formula'> {
  return {
    metaTitle: s.metaTitle,
    metaDescription: s.metaDescription,
    h1: s.h1,
    lead: s.lead,
    assumptions: s.assumptions,
  };
}

export const TOOLS: readonly ToolInfo[] = [emi, commission, stampDuty];

export function findTool(slug: string): ToolInfo | undefined {
  return TOOLS.find((t) => t.slug === slug);
}

/** Every number a model may quote for this tool: the example's inputs/outputs plus 100 (%). */
export function allowedNumbers(example: WorkedExample): number[] {
  const out = [100];
  for (const v of [...example.inputs, ...example.outputs]) {
    out.push(v.value, Math.round(v.value));
  }
  return out;
}

/**
 * Replace `[[key]]` placeholders with the example's display values. Returns the text and any
 * unknown keys (a validation error for the model).
 */
export function fillPlaceholders(
  text: string,
  example: WorkedExample,
  lang: Lang,
): { text: string; unknown: string[] } {
  const all = new Map([...example.inputs, ...example.outputs].map((v) => [v.key, v.display[lang]]));
  const unknown: string[] = [];
  const out = text.replace(/\[\[\s*([a-z_]+)\s*\]\]/g, (m, key: string) => {
    const v = all.get(key);
    if (v === undefined) {
      unknown.push(key);
      return m;
    }
    return v;
  });
  return { text: out, unknown };
}

/** "key = value" lines for the prompt so the model knows which placeholders exist. */
export function placeholderList(example: WorkedExample, lang: Lang): string {
  return [...example.inputs, ...example.outputs]
    .map((v) => `[[${v.key}]] = ${v.display[lang]} (${v.label[lang]})`)
    .join('\n');
}
