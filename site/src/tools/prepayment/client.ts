import {
  type DurationStrings,
  evaluate,
  formatDuration,
  formatInr,
  fromHash,
  toHash,
  type PrepayField,
  type PrepayFormState,
} from './logic.js';

interface ClientStrings extends DurationStrings {
  share: string;
  shareCopied: string;
}

const FIELDS: PrepayField[] = [
  'principal',
  'rate',
  'years',
  'lump',
  'lumpYear',
  'monthly',
  'yearly',
];

/** Wires the prepayment form: live results, inline errors, shareable hash link. No network calls. */
export function initPrepayment(doc: Document, win: Window): void {
  const form = doc.querySelector<HTMLFormElement>('#prepay-form');
  if (!form) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const input = (name: PrepayField) => form.elements.namedItem(name) as HTMLInputElement;
  const set = (name: string, text: string) => {
    const el = doc.querySelector<HTMLElement>(`[data-out="${name}"]`);
    if (el) el.textContent = text;
  };

  const read = (): PrepayFormState =>
    Object.fromEntries(FIELDS.map((f) => [f, input(f).value])) as unknown as PrepayFormState;

  const render = () => {
    const state = read();
    const view = evaluate(state);
    for (const f of FIELDS) {
      const bad = !view.ok && view.errors.includes(f);
      input(f).setAttribute('aria-invalid', String(bad));
      const msg = doc.querySelector<HTMLElement>(`[data-error="${f}"]`);
      if (msg) msg.hidden = !bad;
    }
    const outs = ['saved', 'time-saved', 'emi', 'months-base', 'months-with'];
    if (!view.ok) {
      for (const name of [...outs, 'interest-base', 'interest-with', 'prepaid']) set(name, '—');
      return;
    }
    const r = view.result;
    set('saved', formatInr(r.interestSaved));
    set('time-saved', formatDuration(r.monthsSaved, s));
    set('emi', formatInr(r.emi));
    set('months-base', formatDuration(r.baseline.months, s));
    set('months-with', formatDuration(r.withPrepayment.months, s));
    set('interest-base', formatInr(r.baseline.totalInterest));
    set('interest-with', formatInr(r.withPrepayment.totalInterest));
    set('prepaid', formatInr(r.withPrepayment.totalPrepaid));
    win.history.replaceState(null, '', toHash(state));
  };

  if (win.location.hash.length > 1) {
    const state = fromHash(win.location.hash);
    for (const f of FIELDS) input(f).value = state[f];
  }
  form.addEventListener('input', render);
  render();

  const share = doc.querySelector<HTMLButtonElement>('#prepay-share');
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
