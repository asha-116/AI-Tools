import { AREA_LIMITS, convertToAll } from '@toolshop/tools-core';
import { parseAmount } from '../../lib/format.js';
import type { PageUnit } from './data.js';

export { parseAmount } from '../../lib/format.js';

export interface AreaFormState {
  value: string;
  from: string;
}

export type AreaView =
  { ok: true; rows: Array<{ id: string; value: number }> } | { ok: false; error: 'value' | 'unit' };

export const DEFAULT_STATE: AreaFormState = { value: '1', from: 'acre' };

/** Live site: verified units only. Owner review (#drafts=1): every unit, drafts flagged. */
export function visibleUnits(all: PageUnit[], showDrafts: boolean): PageUnit[] {
  return all.filter((u) => showDrafts || u.verified);
}

export function evaluate(units: PageUnit[], state: AreaFormState): AreaView {
  const from = units.find((u) => u.id === state.from);
  if (!from) return { ok: false, error: 'unit' };
  const value = parseAmount(state.value);
  if (!(value >= 0 && value <= AREA_LIMITS.maxValue)) return { ok: false, error: 'value' };
  return { ok: true, rows: convertToAll(value, from, units) };
}

const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 });
const tiny = new Intl.NumberFormat('en-IN', { maximumSignificantDigits: 4 });

/** Indian digit grouping, up to 4 decimals; small values keep 4 significant digits. */
export function formatArea(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.001) return tiny.format(value);
  return grouped.format(value);
}

/** State lives in the URL hash only (never sent to a server). */
export function toHash(state: AreaFormState, showDrafts: boolean): string {
  const p = new URLSearchParams();
  p.set('v', String(parseAmount(state.value)));
  p.set('u', state.from);
  if (showDrafts) p.set('drafts', '1');
  return `#${p.toString()}`;
}

const NUM = /^[0-9.]{1,20}$/;
const ID = /^[a-z_]{1,20}$/;

export function fromHash(hash: string): { state: AreaFormState; showDrafts: boolean } {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const v = p.get('v');
  const u = p.get('u');
  return {
    state: {
      value: v !== null && NUM.test(v) ? v : DEFAULT_STATE.value,
      from: u !== null && ID.test(u) ? u : DEFAULT_STATE.from,
    },
    showDrafts: p.get('drafts') === '1',
  };
}
