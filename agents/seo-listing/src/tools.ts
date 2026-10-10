// What the SEO/Listing and Social agents know about each live tool: its published strings and a
// worked example whose numbers are COMPUTED by the real tools-core function (never by a model).
// A tool without an entry here cannot get articles or posts: the agent escalates instead.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import areaMeta from '../../../site/src/tools/area/meta.json' with { type: 'json' };
import carpetMeta from '../../../site/src/tools/carpet-area/meta.json' with { type: 'json' };
import eligibilityMeta from '../../../site/src/tools/eligibility/meta.json' with { type: 'json' };
import prepaymentMeta from '../../../site/src/tools/prepayment/meta.json' with { type: 'json' };
import rvbMeta from '../../../site/src/tools/rent-vs-buy/meta.json' with { type: 'json' };
import yieldMeta from '../../../site/src/tools/rental-yield/meta.json' with { type: 'json' };
import standardUnits from '../../../data/land-units/standard.json' with { type: 'json' };
import {
  computeCommission,
  computeEligibility,
  computeEmi,
  computeLoading,
  computePrepayment,
  computeRentalYield,
  computeRentVsBuy,
  computeStampDuty,
  convertArea,
  type AreaUnit,
  type StateRates,
} from '../../../tools-core/src/index.js';
import { formatInr, formatInrExact } from '../../../site/src/lib/format.js';
import { areaStrings } from '../../../site/src/tools/area/strings.js';
import { carpetStrings } from '../../../site/src/tools/carpet-area/strings.js';
import { commissionStrings } from '../../../site/src/tools/commission/strings.js';
import { eligibilityStrings } from '../../../site/src/tools/eligibility/strings.js';
import { emiStrings } from '../../../site/src/tools/emi/strings.js';
import { prepayStrings } from '../../../site/src/tools/prepayment/strings.js';
import { rvbStrings } from '../../../site/src/tools/rent-vs-buy/strings.js';
import { yieldStrings } from '../../../site/src/tools/rental-yield/strings.js';
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
    const shares = r.parties.map((p, i) =>
      i === 0
        ? money('me', { en: 'Your share', hi: 'आपका हिस्सा' }, p.amount, true)
        : money('co', { en: 'Co-broker’s share', hi: 'को-ब्रोकर का हिस्सा' }, p.amount, true),
    );
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
        ...shares,
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

// ---------- Shared helpers for the newer tools ----------

const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** A plain number with a unit, e.g. "43,560 sq ft" / "43,560 वर्ग फ़ुट". */
const amount = (key: string, label: Bilingual, value: number, unit: Bilingual): ExampleValue => ({
  key,
  label,
  value,
  display: {
    en: `${grouped.format(value)} ${unit.en}`.trim(),
    hi: `${grouped.format(value)} ${unit.hi}`.trim(),
  },
});

const pct = (key: string, label: Bilingual, value: number): ExampleValue => {
  const v = Math.round(value * 100) / 100;
  return { key, label, value: v, display: { en: `${v}%`, hi: `${v}%` } };
};

/** Page formula (meta.json) plus the page's own explanation line, in both languages. */
function textOf(
  meta: { formula: string },
  strings: Record<Lang, Parameters<typeof pick>[0] & { formulaWhere: string }>,
): Record<Lang, ToolText> {
  return {
    en: { ...pick(strings.en), formula: [meta.formula, strings.en.formulaWhere] },
    hi: { ...pick(strings.hi), formula: [meta.formula, strings.hi.formulaWhere] },
  };
}

const SAME_CODE: Bilingual = {
  en: 'Example inputs from a published worked example; results computed by the same code the calculator uses.',
  hi: 'प्रकाशित उदाहरण के इनपुट; नतीजे उसी कोड से निकाले गए हैं जो कैलकुलेटर इस्तेमाल करता है।',
};

const YEARS: Bilingual = { en: 'years', hi: 'साल' };
const MONTHS: Bilingual = { en: 'months', hi: 'महीने' };
const SQFT: Bilingual = { en: 'sq ft', hi: 'वर्ग फ़ुट' };

// ---------- Land area ----------

const unit = (id: string): AreaUnit => {
  const u = standardUnits.units.find((x) => x.id === id);
  if (!u) throw new Error(`unknown unit ${id}`);
  return { id: u.id, sq_m: u.sq_m };
};

const area: ToolInfo = {
  slug: 'area',
  moneyTopic: false,
  text: textOf(areaMeta, areaStrings),
  path: toolPath('area'),
  lastVerified: metaReviewed('area'),
  example() {
    const acre = unit('acre');
    const to = (id: string) => convertArea(1, acre, unit(id));
    return {
      inputs: [amount('acres', { en: 'Area', hi: 'क्षेत्रफल' }, 1, { en: 'acre', hi: 'एकड़' })],
      outputs: [
        amount('sq_ft', { en: 'Square feet', hi: 'वर्ग फ़ुट' }, to('sq_ft'), SQFT),
        amount('gaj', { en: 'Gaj (sq yd)', hi: 'गज़' }, to('sq_yd'), { en: 'gaj', hi: 'गज़' }),
        amount('sq_m', { en: 'Square metres', hi: 'वर्ग मीटर' }, to('sq_m'), {
          en: 'sq m',
          hi: 'वर्ग मीटर',
        }),
        amount('hectare', { en: 'Hectare', hi: 'हेक्टेयर' }, to('hectare'), {
          en: 'hectare',
          hi: 'हेक्टेयर',
        }),
      ],
      source: {
        en: 'Unit sizes from data/land-units/standard.json (exact definitions); results computed by the converter’s own code.',
        hi: 'इकाइयों के माप data/land-units/standard.json से (सटीक परिभाषाएँ); नतीजे कन्वर्टर के अपने कोड से।',
      },
    };
  },
};

// ---------- Prepayment ----------

// Published case (tools-core/test/fixtures/prepayment-known-answers.json):
// ₹25 lakh at 9% for 20 years, ₹2 lakh prepaid at the start → about 195 months.
const PREPAY_INPUT = {
  principal: 2_500_000,
  annualRatePercent: 9,
  tenureMonths: 240,
  lumpSums: [{ month: 0, amount: 200_000 }],
};

const prepayment: ToolInfo = {
  slug: 'prepayment',
  moneyTopic: true,
  text: textOf(prepaymentMeta, prepayStrings),
  path: toolPath('prepayment'),
  lastVerified: metaReviewed('prepayment'),
  example() {
    const r = computePrepayment(PREPAY_INPUT);
    return {
      inputs: [
        money('principal', { en: 'Loan amount', hi: 'लोन राशि' }, PREPAY_INPUT.principal),
        percent('rate', { en: 'Interest rate (per year)', hi: 'ब्याज दर (सालाना)' }, 9),
        amount('tenure', { en: 'Tenure', hi: 'अवधि' }, 20, YEARS),
        money('prepaid', { en: 'One-time prepayment now', hi: 'अभी एकमुश्त प्रीपेमेंट' }, 200_000),
      ],
      outputs: [
        money('emi', { en: 'EMI (unchanged)', hi: 'EMI (वही)' }, r.emi),
        money('saved', { en: 'Interest saved', hi: 'ब्याज की बचत' }, r.interestSaved),
        amount(
          'months_saved',
          { en: 'Loan ends sooner by', hi: 'लोन इतना जल्दी खत्म' },
          r.monthsSaved,
          MONTHS,
        ),
        amount('months_new', { en: 'New tenure', hi: 'नई अवधि' }, r.withPrepayment.months, MONTHS),
      ],
      source: SAME_CODE,
    };
  },
};

// ---------- Loan eligibility ----------

// Published case (tools-core/test/fixtures/eligibility-known-answers.json): ₹1 lakh a month,
// 50% FOIR, no EMIs, 8.5% for 20 years → ₹57,61,542.
const ELIG_INPUT = {
  monthlyIncome: 100_000,
  existingEmis: 0,
  foirPercent: 50,
  annualRatePercent: 8.5,
  tenureMonths: 240,
};

const eligibility: ToolInfo = {
  slug: 'eligibility',
  moneyTopic: true,
  text: textOf(eligibilityMeta, eligibilityStrings),
  path: toolPath('eligibility'),
  lastVerified: metaReviewed('eligibility'),
  example() {
    const r = computeEligibility(ELIG_INPUT);
    return {
      inputs: [
        money('income', { en: 'Take-home income per month', hi: 'मासिक आय (हाथ में)' }, 100_000),
        percent('foir', { en: 'Bank’s FOIR limit', hi: 'बैंक की FOIR सीमा' }, 50),
        percent('rate', { en: 'Interest rate (per year)', hi: 'ब्याज दर (सालाना)' }, 8.5),
        amount('tenure', { en: 'Tenure', hi: 'अवधि' }, 20, YEARS),
      ],
      outputs: [
        money('emi', { en: 'EMI that fits', hi: 'EMI जो संभव है' }, r.availableEmi),
        money('loan', { en: 'Largest loan', hi: 'सबसे बड़ा लोन' }, r.maxLoan),
      ],
      source: SAME_CODE,
    };
  },
};

// ---------- Carpet area ----------

// Published case (tools-core/test/fixtures/loading-known-answers.json): ₹1.80 crore for
// 1,500 sq ft super built-up with 1,050 sq ft carpet → ₹17,143 per carpet sq ft.
const CARPET_INPUT = { carpet: 1050, superBuiltUp: 1500, totalPrice: 18_000_000 };

const carpetArea: ToolInfo = {
  slug: 'carpet-area',
  moneyTopic: true,
  text: textOf(carpetMeta, carpetStrings),
  path: toolPath('carpet-area'),
  lastVerified: metaReviewed('carpet-area'),
  example() {
    const r = computeLoading(CARPET_INPUT);
    return {
      inputs: [
        amount('sba', { en: 'Super built-up area', hi: 'सुपर बिल्ट-अप एरिया' }, 1500, SQFT),
        amount('carpet', { en: 'RERA carpet area', hi: 'RERA कारपेट एरिया' }, 1050, SQFT),
        money('total_price', { en: 'Total price', hi: 'कुल कीमत' }, CARPET_INPUT.totalPrice),
      ],
      outputs: [
        pct(
          'loading',
          { en: 'Loading on carpet area', hi: 'कारपेट एरिया पर लोडिंग' },
          r.loadingOnCarpetPercent,
        ),
        amount('common', { en: 'Common area', hi: 'कॉमन एरिया' }, r.commonArea, SQFT),
        money(
          'rate_sba',
          { en: 'Price per sq ft (super built-up)', hi: 'प्रति वर्ग फ़ुट (सुपर बिल्ट-अप)' },
          r.ratePerSuperBuiltUp ?? 0,
        ),
        money(
          'rate_carpet',
          { en: 'Price per sq ft of carpet', hi: 'कारपेट के प्रति वर्ग फ़ुट' },
          r.ratePerCarpet ?? 0,
        ),
      ],
      source: SAME_CODE,
    };
  },
};

// ---------- Rental yield ----------

// Published case (tools-core/test/fixtures/rental-yield-known-answers.json): Pune ₹60 lakh,
// ₹20,000 a month, half a month empty, ₹30,000 costs → 4% gross, 3.33% net.
const YIELD_INPUT = {
  propertyValue: 6_000_000,
  monthlyRent: 20_000,
  vacancyMonths: 0.5,
  yearlyCosts: 30_000,
};

const rentalYield: ToolInfo = {
  slug: 'rental-yield',
  moneyTopic: true,
  text: textOf(yieldMeta, yieldStrings),
  path: toolPath('rental-yield'),
  lastVerified: metaReviewed('rental-yield'),
  example() {
    const r = computeRentalYield(YIELD_INPUT);
    return {
      inputs: [
        money('value', { en: 'Property value', hi: 'प्रॉपर्टी की कीमत' }, 6_000_000),
        money('rent', { en: 'Rent per month', hi: 'मासिक किराया' }, 20_000),
        amount('vacancy', { en: 'Months empty per year', hi: 'साल में खाली महीने' }, 0.5, MONTHS),
        money('costs', { en: 'Owner’s yearly costs', hi: 'मालिक के सालाना खर्च' }, 30_000),
      ],
      outputs: [
        pct('gross', { en: 'Gross yield', hi: 'ग्रॉस यील्ड' }, r.grossYieldPercent),
        pct('net', { en: 'Net yield', hi: 'नेट यील्ड' }, r.netYieldPercent),
        money('income', { en: 'Net income a year', hi: 'सालाना नेट आय' }, r.netIncome),
      ],
      source: SAME_CODE,
    };
  },
};

// ---------- Rent vs buy ----------

// The calculator's default inputs; the published parts are the EMI (₹60 lakh at 8.5% for 20
// years ≈ ₹52,000) and rent escalation (tools-core/test/fixtures/rent-vs-buy-known-answers.json).
const RVB_INPUT = {
  propertyValue: 7_500_000,
  downPayment: 1_500_000,
  purchaseCosts: 500_000,
  annualRatePercent: 8.5,
  tenureMonths: 240,
  ownerYearlyCosts: 30_000,
  appreciationPercent: 5,
  monthlyRent: 25_000,
  rentIncreasePercent: 5,
  investReturnPercent: 8,
  years: 10,
};

const rentVsBuy: ToolInfo = {
  slug: 'rent-vs-buy',
  moneyTopic: true,
  text: textOf(rvbMeta, rvbStrings),
  path: toolPath('rent-vs-buy'),
  lastVerified: metaReviewed('rent-vs-buy'),
  example() {
    const r = computeRentVsBuy(RVB_INPUT);
    return {
      inputs: [
        money('value', { en: 'Property value', hi: 'प्रॉपर्टी की कीमत' }, 7_500_000),
        money('down', { en: 'Down payment', hi: 'डाउन पेमेंट' }, 1_500_000),
        percent('rate', { en: 'Loan rate (per year)', hi: 'लोन दर (सालाना)' }, 8.5),
        money('rent', { en: 'Rent per month now', hi: 'अभी मासिक किराया' }, 25_000),
        percent(
          'rent_increase',
          { en: 'Rent increase per year', hi: 'किराये में सालाना बढ़ोतरी' },
          5,
        ),
        percent(
          'appreciation',
          { en: 'Assumed property value change per year', hi: 'मान लिया गया सालाना कीमत बदलाव' },
          5,
        ),
        percent('return', { en: 'Assumed return on savings', hi: 'मान लिया गया बचत पर रिटर्न' }, 8),
        amount('years', { en: 'Compared over', hi: 'तुलना की अवधि' }, 10, YEARS),
      ],
      outputs: [
        money('emi', { en: 'EMI', hi: 'EMI' }, r.emi),
        money('buyer', { en: 'Buyer has at the end', hi: 'अंत में खरीदार के पास' }, r.buyerWealth),
        money(
          'renter',
          { en: 'Renter has at the end', hi: 'अंत में किरायेदार के पास' },
          r.renterWealth,
        ),
        money('rent_paid', { en: 'Rent paid in total', hi: 'कुल किराया' }, r.rentPaid),
      ],
      source: {
        en: 'Example inputs (the property value change and return are assumptions — change them and the result can flip); results computed by the calculator’s own code.',
        hi: 'उदाहरण के इनपुट (कीमत में बदलाव और रिटर्न अनुमान हैं — इन्हें बदलने से नतीजा उलट सकता है); नतीजे कैलकुलेटर के अपने कोड से।',
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

export const TOOLS: readonly ToolInfo[] = [
  emi,
  commission,
  stampDuty,
  area,
  prepayment,
  eligibility,
  carpetArea,
  rentalYield,
  rentVsBuy,
];

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
