import {
  computeStampDuty,
  STAMP_DUTY_LIMITS,
  type BuyerGender,
  type StampDutyResult,
  type StateRates,
} from '@toolshop/tools-core';
import { parseAmount } from '../../lib/format.js';

export interface SdFormState {
  state: string;
  area: string;
  buyer: BuyerGender;
  value: string;
}

export type SdView =
  | { ok: true; result: StampDutyResult; data: StateRates }
  | { ok: false; error: 'state' | 'value' | 'area' };

/** Live site: verified states only. Owner review (#drafts): everything, drafts flagged. */
export function visibleStates(all: StateRates[], showDrafts: boolean): StateRates[] {
  return all.filter((s) => showDrafts || s.status === 'verified');
}

export function evaluate(states: StateRates[], form: SdFormState): SdView {
  const data = states.find((s) => s.state_code === form.state);
  if (!data) return { ok: false, error: 'state' };
  const value = parseAmount(form.value);
  if (!(value > 0 && value <= STAMP_DUTY_LIMITS.maxValue)) return { ok: false, error: 'value' };
  const hasAreas = (data.areas?.length ?? 0) > 0;
  if (hasAreas && !data.areas?.some((a) => a.id === form.area)) return { ok: false, error: 'area' };
  const result = computeStampDuty(
    data,
    hasAreas ? { value, buyer: form.buyer, area: form.area } : { value, buyer: form.buyer },
  );
  return { ok: true, result, data };
}

/**
 * Rule description and surcharge names in the page language. Hindi falls back to English
 * per item when the data file has no (or a blank) Hindi text.
 */
export function localizeResult(
  r: StampDutyResult,
  lang: 'en' | 'hi',
): { rule: string; surcharges: { name: string; amount: number }[] } {
  const pick = (en: string, hi: string | undefined) => (lang === 'hi' && hi?.trim() ? hi : en);
  return {
    rule: pick(r.ruleDescription, r.ruleDescriptionHi),
    surcharges: r.surcharges.map((x) => ({ name: pick(x.name, x.nameHi), amount: x.amount })),
  };
}

const BUYERS: readonly BuyerGender[] = ['male', 'female', 'joint'];
const CODE = /^[A-Z]{2}$/;
const AREA = /^[a-z0-9-]{1,40}$/;
const NUM = /^[0-9.]{1,15}$/;

export function toHash(form: SdFormState, showDrafts: boolean): string {
  const p = new URLSearchParams({
    s: form.state,
    a: form.area,
    b: form.buyer,
    v: String(parseAmount(form.value)),
  });
  if (showDrafts) p.set('drafts', '1');
  return `#${p.toString()}`;
}

export function fromHash(hash: string): { form: Partial<SdFormState>; showDrafts: boolean } {
  const raw = hash.replace(/^#/, '');
  // "#drafts" alone (owner review link) or "&drafts=1" in a shared link.
  const p = new URLSearchParams(raw);
  const showDrafts = raw === 'drafts' || p.get('drafts') === '1';
  const form: Partial<SdFormState> = {};
  const s = p.get('s');
  if (s && CODE.test(s)) form.state = s;
  const a = p.get('a');
  if (a && AREA.test(a)) form.area = a;
  const b = p.get('b');
  if (b && (BUYERS as readonly string[]).includes(b)) form.buyer = b as BuyerGender;
  const v = p.get('v');
  if (v && NUM.test(v)) form.value = v;
  return { form, showDrafts };
}
