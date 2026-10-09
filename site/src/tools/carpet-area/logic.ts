import {
  carpetFromLoading,
  computeLoading,
  LOADING_LIMITS,
  type LoadingBase,
  type LoadingResult,
} from '@toolshop/tools-core';
import { parseAmount } from '../../lib/format.js';

export { formatInr, parseAmount } from '../../lib/format.js';

/** 1 sq ft in sq m (1 ft = 0.3048 m exactly). */
export const SQ_M_PER_SQ_FT = 0.09290304;

export type PriceMode = 'rate' | 'total';

export interface CarpetFormState {
  superBuiltUp: string;
  carpet: string;
  loading: string;
  loadingBase: LoadingBase;
  priceMode: PriceMode;
  priceValue: string;
}

export type CarpetField = 'superBuiltUp' | 'carpet' | 'loading' | 'priceValue';

export interface CarpetResult extends LoadingResult {
  carpet: number;
  superBuiltUp: number;
  totalPrice?: number;
}

export type CarpetView = { ok: true; result: CarpetResult } | { ok: false; errors: CarpetField[] };

export const DEFAULT_STATE: CarpetFormState = {
  superBuiltUp: '1300',
  carpet: '1000',
  loading: '',
  loadingBase: 'carpet',
  priceMode: 'rate',
  priceValue: '8000',
};

const BASES: readonly LoadingBase[] = ['carpet', 'superBuiltUp'];
const MODES: readonly PriceMode[] = ['rate', 'total'];

const filled = (raw: string) => raw.trim() !== '';
const okArea = (v: number) => v > 0 && v <= LOADING_LIMITS.maxArea;

/** Carpet area comes from the carpet field; if it is empty, from SBA and the loading %. */
export function evaluate(state: CarpetFormState): CarpetView {
  const errors: CarpetField[] = [];
  const superBuiltUp = parseAmount(state.superBuiltUp);
  if (!okArea(superBuiltUp)) errors.push('superBuiltUp');

  let carpet = Number.NaN;
  if (filled(state.carpet)) {
    carpet = parseAmount(state.carpet);
    if (!okArea(carpet) || (okArea(superBuiltUp) && carpet > superBuiltUp)) errors.push('carpet');
  } else if (filled(state.loading)) {
    const loading = parseAmount(state.loading);
    const max = state.loadingBase === 'carpet' ? LOADING_LIMITS.maxLoadingPercent : 99.99;
    if (!(loading >= 0 && loading <= max)) errors.push('loading');
    else if (okArea(superBuiltUp)) {
      carpet = carpetFromLoading(superBuiltUp, loading, state.loadingBase);
    }
  } else {
    errors.push('carpet');
  }

  let totalPrice: number | undefined;
  if (filled(state.priceValue)) {
    const v = parseAmount(state.priceValue);
    totalPrice = state.priceMode === 'rate' ? v * superBuiltUp : v;
    // A bad SBA is already reported; don't blame the rate for it.
    const tooBig = okArea(superBuiltUp) && !(totalPrice <= LOADING_LIMITS.maxPrice);
    if (!(v > 0) || tooBig) errors.push('priceValue');
  }
  if (errors.length > 0) return { ok: false, errors };

  const r = computeLoading({
    carpet,
    superBuiltUp,
    ...(totalPrice === undefined ? {} : { totalPrice }),
  });
  return {
    ok: true,
    result: { ...r, carpet, superBuiltUp, ...(totalPrice === undefined ? {} : { totalPrice }) },
  };
}

const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** Indian digit grouping, up to 2 decimals. */
export function formatNumber(value: number): string {
  return grouped.format(value);
}

/** "30%" / "23.1%" — one decimal at most. */
export function formatPercent(value: number): string {
  return `${String(Math.round(value * 10) / 10)}%`;
}

const KEYS: Array<[keyof CarpetFormState, string]> = [
  ['superBuiltUp', 's'],
  ['carpet', 'c'],
  ['loading', 'l'],
  ['loadingBase', 'b'],
  ['priceMode', 'm'],
  ['priceValue', 'v'],
];

/** State lives in the URL hash only (never sent to a server). Empty fields are left out. */
export function toHash(state: CarpetFormState): string {
  const p = new URLSearchParams();
  for (const [field, key] of KEYS) {
    const raw = state[field];
    if (!filled(raw)) continue;
    if (field === 'loadingBase' || field === 'priceMode') {
      p.set(key, raw);
      continue;
    }
    const v = parseAmount(raw);
    p.set(key, Number.isFinite(v) ? String(v) : '0');
  }
  return `#${p.toString()}`;
}

const NUM = /^[0-9.]{1,15}$/;

export function fromHash(hash: string): CarpetFormState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out = { ...DEFAULT_STATE };
  // A shared link sets exactly the fields it carries; numeric fields it leaves out are empty.
  if (hash.replace(/^#/, '') !== '') {
    out.superBuiltUp = '';
    out.carpet = '';
    out.loading = '';
    out.priceValue = '';
  }
  for (const [field, key] of KEYS) {
    const v = p.get(key);
    if (v === null) continue;
    if (field === 'loadingBase') {
      if ((BASES as readonly string[]).includes(v)) out.loadingBase = v as LoadingBase;
    } else if (field === 'priceMode') {
      if ((MODES as readonly string[]).includes(v)) out.priceMode = v as PriceMode;
    } else if (NUM.test(v)) {
      out[field] = v;
    }
  }
  return out;
}
