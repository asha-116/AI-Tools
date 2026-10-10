import {
  evaluate,
  formatInr,
  formatSigned,
  fromHash,
  toHash,
  type TransferField,
  type TransferFormState,
} from './logic.js';

interface ClientStrings {
  share: string;
  shareCopied: string;
  months: string;
  breakEvenNever: string;
  breakEvenChanged: string;
}

const FIELDS: TransferField[] = [
  'outstanding',
  'currentRate',
  'yearsLeft',
  'newRate',
  'newYears',
  'switchingCosts',
];

const OUTPUTS = [
  'net',
  'new-emi',
  'current-emi',
  'emi-drop',
  'interest-now',
  'interest-new',
  'interest-saved',
  'break-even',
];

/** Wires the balance-transfer form: live results, inline errors, shareable hash link. No network calls. */
export function initBalanceTransfer(doc: Document, win: Window): void {
  const form = doc.querySelector<HTMLFormElement>('#bt-form');
  if (!form) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const input = (name: TransferField) => form.elements.namedItem(name) as HTMLInputElement;
  const set = (name: string, text: string) => {
    const el = doc.querySelector<HTMLElement>(`[data-out="${name}"]`);
    if (el) el.textContent = text;
  };

  const read = (): TransferFormState =>
    Object.fromEntries(FIELDS.map((f) => [f, input(f).value])) as unknown as TransferFormState;

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
      for (const n of OUTPUTS) set(n, '—');
      return;
    }
    const r = view.result;
    const sameTenure = state.newYears.trim() === '' || state.newYears === state.yearsLeft;
    set('net', formatSigned(r.netSaving));
    set('new-emi', formatInr(r.newEmi));
    set('current-emi', formatInr(r.currentEmi));
    set('emi-drop', formatSigned(r.emiDrop));
    set('interest-now', formatInr(r.currentInterestLeft));
    set('interest-new', formatInr(r.newInterest));
    set('interest-saved', formatSigned(r.interestSaved));
    set(
      'break-even',
      r.breakEvenMonths !== null
        ? `${String(r.breakEvenMonths)} ${s.months}`
        : sameTenure
          ? s.breakEvenNever
          : s.breakEvenChanged,
    );
    win.history.replaceState(null, '', toHash(state));
  };

  if (win.location.hash.length > 1) {
    const state = fromHash(win.location.hash);
    for (const f of FIELDS) input(f).value = state[f];
  }
  form.addEventListener('input', render);
  render();

  const share = doc.querySelector<HTMLButtonElement>('#bt-share');
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
