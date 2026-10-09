import {
  evaluate,
  formatInr,
  formatSignedInr,
  fromHash,
  toHash,
  type RvbField,
  type RvbFormState,
} from './logic.js';

interface ClientStrings {
  share: string;
  shareCopied: string;
}

const FIELDS: RvbField[] = [
  'propertyValue',
  'downPayment',
  'purchaseCosts',
  'rate',
  'loanYears',
  'ownerCosts',
  'appreciation',
  'rent',
  'rentIncrease',
  'investReturn',
  'years',
];
const OUTS = [
  'difference',
  'buyer',
  'renter',
  'property',
  'loan-left',
  'emi',
  'cash-out',
  'rent-paid',
];

/** Wires the rent vs buy form: live results, inline errors, shareable hash link. No network calls. */
export function initRentVsBuy(doc: Document, win: Window): void {
  const form = doc.querySelector<HTMLFormElement>('#rvb-form');
  if (!form) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const input = (name: RvbField) => form.elements.namedItem(name) as HTMLInputElement;
  const set = (name: string, text: string) => {
    const el = doc.querySelector<HTMLElement>(`[data-out="${name}"]`);
    if (el) el.textContent = text;
  };

  const read = (): RvbFormState =>
    Object.fromEntries(FIELDS.map((f) => [f, input(f).value])) as unknown as RvbFormState;

  const render = () => {
    const state = read();
    const view = evaluate(state);
    for (const f of FIELDS) {
      const bad = !view.ok && view.errors.includes(f);
      input(f).setAttribute('aria-invalid', String(bad));
      const msg = doc.querySelector<HTMLElement>(`[data-error="${f}"]`);
      if (msg) msg.hidden = !bad;
    }
    if (!view.ok) {
      for (const n of OUTS) set(n, '—');
      return;
    }
    const r = view.result;
    set('difference', formatSignedInr(r.difference, formatInr));
    set('buyer', formatSignedInr(r.buyerWealth, formatInr));
    set('renter', formatInr(r.renterWealth));
    set('property', formatInr(r.propertyEnd));
    set('loan-left', formatInr(r.loanLeft));
    set('emi', formatInr(r.emi));
    set('cash-out', formatInr(r.buyerCashOut));
    set('rent-paid', formatInr(r.rentPaid));
    win.history.replaceState(null, '', toHash(state));
  };

  if (win.location.hash.length > 1) {
    const state = fromHash(win.location.hash);
    for (const f of FIELDS) input(f).value = state[f];
  }
  form.addEventListener('input', render);
  render();

  const share = doc.querySelector<HTMLButtonElement>('#rvb-share');
  share?.addEventListener('click', () => {
    const url = win.location.href;
    const done = () => {
      share.textContent = s.shareCopied;
      win.setTimeout(() => (share.textContent = s.share), 2000);
    };
    win.navigator.clipboard.writeText(url).then(done, () => {
      win.prompt(s.share, url);
    });
  });
}
