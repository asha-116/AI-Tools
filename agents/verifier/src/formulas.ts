// Formula registry for PROCEDURE step 2: which tools-core function each source file and
// known-answer fixture belongs to, the cited formula description the verifier model computes
// from (never our code), and how to run our own function on the same inputs.
//
// Add an entry here when tools-core gains a function with a known-answer fixture. A changed
// tools-core/src file without an entry fails the Verifier (it cannot be checked independently).

import gunthaUnits from '../../../data/land-units/guntha.json' with { type: 'json' };
import regionalUnits from '../../../data/land-units/regional.json' with { type: 'json' };
import standardUnits from '../../../data/land-units/standard.json' with { type: 'json' };
import {
  computeCommission,
  computeEligibility,
  computeEmi,
  computeLoading,
  computePrepayment,
  computeRentalYield,
  convertArea,
  type AreaUnit,
  type CommissionInput,
  type EligibilityInput,
  type EmiInput,
  type LoadingInput,
  type PrepaymentInput,
  type RentalYieldInput,
} from '../../../tools-core/src/index.js';

export interface FormulaCase {
  id: string;
  /** Inputs only. The fixture's expected answers are never sent to the verifier model. */
  input: Record<string, unknown>;
  sources: string[];
}

export interface FormulaEntry {
  id: string;
  functionName: string;
  sourceFiles: string[];
  fixture: string;
  /** Plain-language formula, from the cited sources. This is all the verifier model sees. */
  description: string;
  toInput(raw: Record<string, unknown>): Record<string, unknown>;
  /** Output fields to compute and compare for this input. */
  fields(input: Record<string, unknown>): string[];
  /** Our implementation, as named numbers. */
  run(input: Record<string, unknown>): Record<string, number>;
}

/** Shared helpers: a change here re-checks every registered formula. */
export const SHARED_SOURCES = ['tools-core/src/index.ts', 'tools-core/src/numbers.ts'];

/** Unit sizes from data/land-units (our side only; the verifier model gets the description). */
const AREA_UNITS: AreaUnit[] = [
  ...standardUnits.units,
  ...gunthaUnits.units,
  ...regionalUnits.units,
].map((u) => ({
  id: u.id,
  sq_m: u.sq_m,
}));
const areaUnit = (id: unknown): AreaUnit => {
  const u = AREA_UNITS.find((x) => x.id === id);
  if (!u) throw new Error(`unknown area unit ${String(id)}`);
  return u;
};

/** True when the only prepayment is one lump sum before the first EMI (closed form exists). */
const upfrontOnly = (i: Record<string, unknown>): boolean =>
  !i.monthlyExtra &&
  !i.yearlyExtra &&
  Array.isArray(i.lumpSums) &&
  i.lumpSums.length === 1 &&
  (i.lumpSums[0] as { month?: unknown }).month === 0;

const partyCount = (input: Record<string, unknown>): number =>
  Array.isArray(input.parties) ? input.parties.length : 0;

export const FORMULAS: FormulaEntry[] = [
  {
    id: 'emi',
    functionName: 'computeEmi',
    sourceFiles: ['tools-core/src/emi.ts'],
    fixture: 'tools-core/test/fixtures/emi-known-answers.json',
    description: [
      'Equated monthly instalment (EMI) on a reducing-balance loan with a fixed interest rate',
      '(source: https://en.wikipedia.org/wiki/Equated_monthly_installment).',
      'Inputs: principal P in rupees; annualRatePercent, the nominal yearly rate in percent;',
      'tenureMonths n, the number of monthly instalments.',
      'Monthly rate r = annualRatePercent / 12 / 100.',
      'emi = P × r × (1 + r)^n / ((1 + r)^n − 1); when r = 0, emi = P / n.',
      'totalPayment = emi × n, using the unrounded emi. totalInterest = totalPayment − P.',
      'Do not round any output.',
    ].join(' '),
    toInput: (c) => ({
      principal: c.principal,
      annualRatePercent: c.annualRatePercent,
      tenureMonths: c.tenureMonths,
    }),
    fields: () => ['emi', 'totalPayment', 'totalInterest'],
    run: (input) => {
      const r = computeEmi(input as unknown as EmiInput);
      return { emi: r.emi, totalPayment: r.totalPayment, totalInterest: r.totalInterest };
    },
  },
  {
    id: 'commission',
    functionName: 'computeCommission',
    sourceFiles: ['tools-core/src/commission.ts'],
    fixture: 'tools-core/test/fixtures/commission-known-answers.json',
    description: [
      'Real-estate brokerage commission with GST charged on top and a split between parties',
      '(source: https://razorpay.com/learn/gst-on-brokerage-and-commission/).',
      "Inputs: dealValue in rupees (present when commission.type is 'percent');",
      "commission is either {type: 'percent', percent} or {type: 'fixed', amount};",
      'gstPercent; parties, a list of {label, percent} whose percents add up to 100.',
      'gross = dealValue × percent / 100, or the fixed amount.',
      'gst = gross × gstPercent / 100. totalPayable = gross + gst.',
      'party_k (k = 1, 2, … in list order) = gross × (percent of party k) / 100.',
      'Round every money amount to 2 decimals (paise).',
    ].join(' '),
    toInput: (c) => (c.input ?? {}) as Record<string, unknown>,
    fields: (input) => [
      'gross',
      'gst',
      'totalPayable',
      ...Array.from({ length: partyCount(input) }, (_, i) => `party_${String(i + 1)}`),
    ],
    run: (input) => {
      const r = computeCommission(input as unknown as CommissionInput);
      const out: Record<string, number> = {
        gross: r.gross,
        gst: r.gst,
        totalPayable: r.totalPayable,
      };
      r.parties.forEach((p, i) => (out[`party_${String(i + 1)}`] = p.amount));
      return out;
    },
  },
  {
    id: 'prepayment',
    functionName: 'computePrepayment',
    sourceFiles: ['tools-core/src/prepayment.ts'],
    fixture: 'tools-core/test/fixtures/prepayment-known-answers.json',
    description: [
      'Home-loan prepayment that keeps the EMI and shortens the tenure, on a reducing balance',
      '(source: https://en.wikipedia.org/wiki/Mortgage_calculator).',
      'Inputs: principal P; annualRatePercent; tenureMonths n; optional lumpSums',
      '[{month, amount}] (month 0 = paid before the first EMI), monthlyExtra, yearlyExtra.',
      'r = annualRatePercent / 1200. emi = P × r × (1 + r)^n / ((1 + r)^n − 1).',
      'baselineInterest = emi × n − P.',
      'When the only prepayment is one lump sum L at month 0, the loan is repaid in',
      'months = ceil(−ln(1 − r × (P − L) / emi) / ln(1 + r)) payments of at most emi.',
      'Do not round emi or baselineInterest.',
    ].join(' '),
    toInput: (c) => (c.input ?? {}) as Record<string, unknown>,
    fields: (input) => ['emi', 'baselineInterest', ...(upfrontOnly(input) ? ['months'] : [])],
    run: (input) => {
      const r = computePrepayment(input as unknown as PrepaymentInput);
      return {
        emi: r.emi,
        baselineInterest: r.baseline.totalInterest,
        months: r.withPrepayment.months,
      };
    },
  },
  {
    id: 'eligibility',
    functionName: 'computeEligibility',
    sourceFiles: ['tools-core/src/eligibility.ts'],
    fixture: 'tools-core/test/fixtures/eligibility-known-answers.json',
    description: [
      'Home-loan eligibility by FOIR (fixed obligations to income ratio): the largest loan whose',
      'EMI fits within the share of income the lender allows for all EMIs',
      '(source: https://en.wikipedia.org/wiki/Mortgage_calculator, present value of an annuity).',
      'Inputs: monthlyIncome; existingEmis; foirPercent; annualRatePercent; tenureMonths n.',
      'maxTotalEmi = monthlyIncome × foirPercent / 100.',
      'availableEmi = maxTotalEmi − existingEmis, or 0 if that is negative.',
      'r = annualRatePercent / 1200. maxLoan = availableEmi × (1 − (1 + r)^(−n)) / r;',
      'when r = 0, maxLoan = availableEmi × n. Do not round any output.',
    ].join(' '),
    toInput: (c) => (c.input ?? {}) as Record<string, unknown>,
    fields: () => ['maxTotalEmi', 'availableEmi', 'maxLoan'],
    run: (input) => {
      const r = computeEligibility(input as unknown as EligibilityInput);
      return { maxTotalEmi: r.maxTotalEmi, availableEmi: r.availableEmi, maxLoan: r.maxLoan };
    },
  },
  {
    id: 'loading',
    functionName: 'computeLoading',
    sourceFiles: ['tools-core/src/loading.ts'],
    fixture: 'tools-core/test/fixtures/loading-known-answers.json',
    description: [
      'Apartment loading: super built-up area versus carpet area, and the price per sq ft of each',
      '(source: https://housing.com/news/loading-factor-in-apartments/).',
      'Inputs: carpet; superBuiltUp (same unit); optional totalPrice in rupees.',
      'commonArea = superBuiltUp − carpet.',
      'loadingOnCarpetPercent = commonArea / carpet × 100.',
      'commonSharePercent = commonArea / superBuiltUp × 100.',
      'When totalPrice is given: ratePerSuperBuiltUp = totalPrice / superBuiltUp and',
      'ratePerCarpet = totalPrice / carpet. Do not round any output.',
    ].join(' '),
    toInput: (c) => (c.input ?? {}) as Record<string, unknown>,
    fields: (input) => [
      'commonArea',
      'loadingOnCarpetPercent',
      'commonSharePercent',
      ...(input.totalPrice === undefined ? [] : ['ratePerSuperBuiltUp', 'ratePerCarpet']),
    ],
    run: (input) => {
      const r = computeLoading(input as unknown as LoadingInput);
      const out: Record<string, number> = {
        commonArea: r.commonArea,
        loadingOnCarpetPercent: r.loadingOnCarpetPercent,
        commonSharePercent: r.commonSharePercent,
      };
      if (r.ratePerSuperBuiltUp !== undefined) out.ratePerSuperBuiltUp = r.ratePerSuperBuiltUp;
      if (r.ratePerCarpet !== undefined) out.ratePerCarpet = r.ratePerCarpet;
      return out;
    },
  },
  {
    id: 'rental-yield',
    functionName: 'computeRentalYield',
    sourceFiles: ['tools-core/src/rentalYield.ts'],
    fixture: 'tools-core/test/fixtures/rental-yield-known-answers.json',
    description: [
      'Gross and net rental yield on a property, before income tax',
      '(source: https://housing.com/news/rental-yield/).',
      'Inputs: propertyValue; monthlyRent; optional purchaseCosts, yearlyCosts and',
      'vacancyMonths (each 0 when missing).',
      'investment = propertyValue + purchaseCosts. annualRent = monthlyRent × 12.',
      'collectedRent = monthlyRent × (12 − vacancyMonths). netIncome = collectedRent − yearlyCosts.',
      'grossYieldPercent = annualRent / investment × 100.',
      'netYieldPercent = netIncome / investment × 100. Do not round any output.',
    ].join(' '),
    toInput: (c) => (c.input ?? {}) as Record<string, unknown>,
    fields: () => [
      'annualRent',
      'collectedRent',
      'netIncome',
      'grossYieldPercent',
      'netYieldPercent',
    ],
    run: (input) => {
      const r = computeRentalYield(input as unknown as RentalYieldInput);
      return {
        annualRent: r.annualRent,
        collectedRent: r.collectedRent,
        netIncome: r.netIncome,
        grossYieldPercent: r.grossYieldPercent,
        netYieldPercent: r.netYieldPercent,
      };
    },
  },
  {
    id: 'area',
    functionName: 'convertArea',
    sourceFiles: [
      'tools-core/src/area.ts',
      'data/land-units/standard.json',
      'data/land-units/guntha.json',
      'data/land-units/regional.json',
    ],
    fixture: 'tools-core/test/fixtures/area-known-answers.json',
    description: [
      'Land-area unit conversion (source: https://en.wikipedia.org/wiki/International_yard_and_pound',
      'and https://1acre.in/land-unit-converter/guntha-to-sqft).',
      'Inputs: value, a non-negative area; from and to, unit ids.',
      'Unit sizes: sq_ft = 1 square foot (1 foot = 0.3048 m exactly); sq_yd = 1 square yard',
      '(gaj) = 9 sq ft; sq_m = 1 square metre; are = 100 sq m; acre = 43,560 sq ft;',
      'hectare = 10,000 sq m;',
      'guntha = 1,089 sq ft; cent = 435.6 sq ft; ground = 2,400 sq ft; marla = 272.25 sq ft;',
      'kanal = 5,445 sq ft.',
      'result = value × (size of from unit) ÷ (size of to unit). Do not round.',
    ].join(' '),
    toInput: (c) => ({ value: c.value, from: c.from, to: c.to }),
    fields: () => ['result'],
    run: (input) => ({
      result: convertArea(input.value as number, areaUnit(input.from), areaUnit(input.to)),
    }),
  },
];

/** Registry entries touched by these changed files, plus formula files we cannot check. */
export function selectEntries(
  formulaFiles: readonly string[],
  registry: readonly FormulaEntry[] = FORMULAS,
): { entries: FormulaEntry[]; unregistered: string[] } {
  const all = formulaFiles.some((f) => SHARED_SOURCES.includes(f));
  const entries = registry.filter(
    (e) => all || formulaFiles.some((f) => e.sourceFiles.includes(f) || e.fixture === f),
  );
  const known = new Set([
    ...SHARED_SOURCES,
    ...registry.flatMap((e) => [...e.sourceFiles, e.fixture]),
  ]);
  return { entries, unregistered: formulaFiles.filter((f) => !known.has(f)) };
}

/** Read a fixture and keep only the inputs and sources of each case. */
export function loadCases(entry: FormulaEntry, read: (path: string) => string): FormulaCase[] {
  const doc = JSON.parse(read(entry.fixture)) as { cases?: Record<string, unknown>[] };
  return (doc.cases ?? []).map((c, i) => ({
    id: `${entry.id}-${String(i + 1)}`,
    input: entry.toInput(c),
    sources: Array.isArray(c.sources) ? (c.sources as string[]) : [],
  }));
}

export function runOurs(
  entry: FormulaEntry,
  input: Record<string, unknown>,
): { values: Record<string, number> } | { error: string } {
  try {
    return { values: entry.run(input) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** PROCEDURE tolerance: within ₹1 or 0.01% of our value, whichever is larger. */
export function withinTolerance(expected: number, actual: number): boolean {
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
  return Math.abs(expected - actual) <= Math.max(1, Math.abs(actual) * 1e-4);
}

/** Small deterministic PRNG (same seed → same sample on every re-run of a PR). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every number in a nested input, keyed by its dotted path. */
export function numericLeaves(value: unknown, prefix = ''): Record<string, number> {
  if (typeof value === 'number') return { [prefix]: value };
  if (value === null || typeof value !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value)) {
    Object.assign(out, numericLeaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

/**
 * Pick `n` cases: up to half are edge cases (the min and max of each numeric input), the rest
 * typical cases drawn with a seeded shuffle. Deterministic for a given seed.
 */
export function sampleCases(cases: readonly FormulaCase[], n: number, seed: number): FormulaCase[] {
  if (cases.length <= n) return [...cases];
  const leaves = cases.map((c) => numericLeaves(c.input));
  const keys = [...new Set(leaves.flatMap((l) => Object.keys(l)))];
  const edge = new Set<number>();
  for (const k of keys) {
    let lo = -1;
    let hi = -1;
    leaves.forEach((l, i) => {
      const v = l[k];
      if (v === undefined) return;
      if (lo < 0 || v < (leaves[lo]?.[k] as number)) lo = i;
      if (hi < 0 || v > (leaves[hi]?.[k] as number)) hi = i;
    });
    edge.add(lo).add(hi);
  }
  const edges = [...edge].filter((i) => i >= 0).sort((a, b) => a - b);
  const picked = edges.slice(0, Math.ceil(n / 2));
  const rest = cases.map((_, i) => i).filter((i) => !picked.includes(i) && !edge.has(i));
  const rand = mulberry32(seed);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as number, rest[i] as number];
  }
  const leftoverEdges = edges.filter((i) => !picked.includes(i));
  const order = [...picked, ...rest, ...leftoverEdges].slice(0, n);
  return order.map((i) => cases[i] as FormulaCase);
}

/** Split `total` cases across `k` formulas as evenly as possible (earlier ones get extra). */
export function allocate(total: number, k: number): number[] {
  return Array.from({ length: k }, (_, i) => Math.floor(total / k) + (i < total % k ? 1 : 0));
}
