import {
  evaluate,
  formatInr,
  formatPercent,
  fromHash,
  toHash,
  type EligibilityField,
  type EligibilityFormState,
} from './logic.js';

interface ClientStrings {
  share: string;
  shareCopied: string;
}

const FIELDS: EligibilityField[] = [
  'income',
  'coIncome',
  'existing',
  'foir',
  'rate',
  'years',
  'propertyPrice',
];

/** Wires the eligibility form: live results, inline errors, shareable hash link. No network calls. */
export function initEligibility(doc: Document, win: Window): void {
  const form = doc.querySelector<HTMLFormElement>('#elig-form');
  if (!form) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const input = (name: EligibilityField) => form.elements.namedItem(name) as HTMLInputElement;
  const set = (name: string, text: string) => {
    const el = doc.querySelector<HTMLElement>(`[data-out="${name}"]`);
    if (el) el.textContent = text;
  };
  const show = (selector: string, visible: boolean) => {
    const el = doc.querySelector<HTMLElement>(selector);
    if (el) el.hidden = !visible;
  };

  const read = (): EligibilityFormState =>
    Object.fromEntries(FIELDS.map((f) => [f, input(f).value])) as unknown as EligibilityFormState;

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
      for (const name of ['loan', 'emi', 'limit', 'existing', 'down']) set(name, '—');
      show('[data-row="down"]', false);
      show('[data-note="no-room"]', false);
      return;
    }
    const r = view.result;
    set('loan', formatInr(r.maxLoan));
    set('emi', formatInr(r.availableEmi));
    set('limit', formatInr(r.maxTotalEmi));
    set('existing', formatPercent(r.currentFoirPercent));
    set('down', r.downPayment === undefined ? '—' : formatInr(r.downPayment));
    show('[data-row="down"]', r.downPayment !== undefined);
    show('[data-note="no-room"]', r.availableEmi === 0);
    win.history.replaceState(null, '', toHash(state));
  };

  if (win.location.hash.length > 1) {
    const state = fromHash(win.location.hash);
    for (const f of FIELDS) input(f).value = state[f];
  }
  form.addEventListener('input', render);
  render();

  const share = doc.querySelector<HTMLButtonElement>('#elig-share');
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
