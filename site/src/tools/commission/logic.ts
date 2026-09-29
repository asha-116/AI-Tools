import { COMMISSION_LIMITS, computeCommission, type CommissionResult } from '@toolshop/tools-core';
import { parseAmount } from '../../lib/format.js';

export interface PartyState {
  label: string;
  share: string;
}

export interface CommissionFormState {
  mode: 'percent' | 'fixed';
  deal: string;
  rate: string;
  amount: string;
  gst: string;
  parties: PartyState[];
}

export type CommissionField = 'deal' | 'rate' | 'amount' | 'gst' | 'shares';

export type CommissionView =
  | { ok: true; result: CommissionResult }
  | { ok: false; errors: CommissionField[]; sharesTotal: number };

export const MAX_LABEL = 40;

export function defaultState(labels: [string, string]): CommissionFormState {
  return {
    mode: 'percent',
    deal: '7500000',
    rate: '1',
    amount: '',
    gst: '0',
    parties: [
      { label: labels[0], share: '50' },
      { label: labels[1], share: '50' },
    ],
  };
}

export function sharesTotal(parties: PartyState[]): number {
  return parties.reduce((s, p) => s + (parseAmount(p.share) || 0), 0);
}

export function evaluate(state: CommissionFormState): CommissionView {
  const errors: CommissionField[] = [];
  const deal = parseAmount(state.deal);
  const rate = parseAmount(state.rate);
  const amount = parseAmount(state.amount);
  const gst = state.gst.trim() === '' ? 0 : parseAmount(state.gst);

  if (state.mode === 'percent') {
    if (!(deal > 0 && deal <= COMMISSION_LIMITS.maxDealValue)) errors.push('deal');
    if (!(rate > 0 && rate <= COMMISSION_LIMITS.maxCommissionPercent)) errors.push('rate');
  } else if (!(amount > 0 && amount <= COMMISSION_LIMITS.maxFixedAmount)) {
    errors.push('amount');
  }
  if (!(gst >= 0 && gst <= COMMISSION_LIMITS.maxGstPercent)) errors.push('gst');

  const total = sharesTotal(state.parties);
  const sharesOk =
    state.parties.length >= 1 &&
    state.parties.length <= COMMISSION_LIMITS.maxParties &&
    state.parties.every((p) => parseAmount(p.share) >= 0) &&
    Math.abs(total - 100) < 1e-6;
  if (!sharesOk) errors.push('shares');

  if (errors.length > 0) return { ok: false, errors, sharesTotal: total };

  return {
    ok: true,
    result: computeCommission({
      dealValue: state.mode === 'percent' ? deal : undefined,
      commission:
        state.mode === 'percent' ? { type: 'percent', percent: rate } : { type: 'fixed', amount },
      gstPercent: gst,
      parties: state.parties.map((p) => ({ label: p.label, percent: parseAmount(p.share) })),
    }),
  };
}

/** State lives in the URL hash only (never sent to a server). */
export function toHash(state: CommissionFormState): string {
  const p = new URLSearchParams();
  p.set('m', state.mode === 'fixed' ? 'f' : 'p');
  if (state.mode === 'fixed') p.set('a', String(parseAmount(state.amount)));
  else {
    p.set('d', String(parseAmount(state.deal)));
    p.set('r', state.rate.trim());
  }
  p.set('g', state.gst.trim() || '0');
  for (const party of state.parties) {
    p.append('s', `${party.share.trim()}~${party.label.slice(0, MAX_LABEL)}`);
  }
  return `#${p.toString()}`;
}

const NUM = /^[0-9.]{1,15}$/;

export function fromHash(hash: string, fallback: CommissionFormState): CommissionFormState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const num = (key: string, dflt: string) => {
    const v = p.get(key);
    return v !== null && NUM.test(v) ? v : dflt;
  };
  const parties = p
    .getAll('s')
    .slice(0, COMMISSION_LIMITS.maxParties)
    .map((raw) => {
      const i = raw.indexOf('~');
      const share = i === -1 ? raw : raw.slice(0, i);
      const label = i === -1 ? '' : raw.slice(i + 1, i + 1 + MAX_LABEL);
      return { share: NUM.test(share) ? share : '0', label };
    });
  return {
    mode: p.get('m') === 'f' ? 'fixed' : 'percent',
    deal: num('d', fallback.deal),
    rate: num('r', fallback.rate),
    amount: num('a', fallback.amount),
    gst: num('g', fallback.gst),
    parties: parties.length > 0 ? parties : fallback.parties,
  };
}
