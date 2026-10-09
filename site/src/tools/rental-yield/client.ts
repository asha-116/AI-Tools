import {
  evaluate,
  formatInr,
  formatPercent,
  formatYears,
  fromHash,
  toHash,
  type YieldField,
  type YieldFormState,
} from './logic.js';

interface ClientStrings {
  share: string;
  shareCopied: string;
}

const FIELDS: YieldField[] = [
  'propertyValue',
  'purchaseCosts',
  'monthlyRent',
  'vacancyMonths',
  'yearlyCosts',
];

/** Wires the rental-yield form: live results, inline errors, shareable hash link. No network calls. */
export function initRentalYield(doc: Document, win: Window): void {
  const form = doc.querySelector<HTMLFormElement>('#yield-form');
  if (!form) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const input = (name: YieldField) => form.elements.namedItem(name) as HTMLInputElement;
  const set = (name: string, text: string) => {
    const el = doc.querySelector<HTMLElement>(`[data-out="${name}"]`);
    if (el) el.textContent = text;
  };

  const read = (): YieldFormState =>
    Object.fromEntries(FIELDS.map((f) => [f, input(f).value])) as unknown as YieldFormState;

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
      for (const n of ['net', 'gross', 'investment', 'annual', 'collected', 'income', 'years'])
        set(n, '—');
      return;
    }
    const r = view.result;
    set('net', formatPercent(r.netYieldPercent));
    set('gross', formatPercent(r.grossYieldPercent));
    set('investment', formatInr(r.investment));
    set('annual', formatInr(r.annualRent));
    set('collected', formatInr(r.collectedRent));
    set('income', formatInr(r.netIncome));
    set('years', formatYears(r.yearsOfRent));
    win.history.replaceState(null, '', toHash(state));
  };

  if (win.location.hash.length > 1) {
    const state = fromHash(win.location.hash);
    for (const f of FIELDS) input(f).value = state[f];
  }
  form.addEventListener('input', render);
  render();

  const share = doc.querySelector<HTMLButtonElement>('#yield-share');
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
