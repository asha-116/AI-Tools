import { evaluate, formatInr, fromHash, toHash, type EmiFormState } from './logic.js';

interface ClientStrings {
  firstMonth: string;
  share: string;
  shareCopied: string;
}

/** Wires the EMI form: live results, inline errors, shareable hash link. No network calls. */
export function initEmi(doc: Document, win: Window): void {
  const form = doc.querySelector<HTMLFormElement>('#emi-form');
  if (!form) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  const out = (name: string) => doc.querySelector<HTMLElement>(`[data-out="${name}"]`);

  const read = (): EmiFormState => ({
    principal: field('principal').value,
    rate: field('rate').value,
    tenure: field('tenure').value,
    unit: field('unit').value === 'months' ? 'months' : 'years',
  });

  const write = (state: EmiFormState) => {
    field('principal').value = state.principal;
    field('rate').value = state.rate;
    field('tenure').value = state.tenure;
    field('unit').value = state.unit;
  };

  const render = () => {
    const state = read();
    const view = evaluate(state);
    for (const key of ['principal', 'rate', 'tenure'] as const) {
      const bad = !view.ok && view.errors.includes(key);
      const input = field(key);
      if (key !== 'tenure' || input instanceof HTMLInputElement) {
        input.setAttribute('aria-invalid', String(bad));
      }
      const msg = doc.querySelector<HTMLElement>(`[data-error="${key}"]`);
      if (msg) msg.hidden = !bad;
    }
    const set = (name: string, text: string) => {
      const el = out(name);
      if (el) el.textContent = text;
    };
    if (!view.ok) {
      for (const name of ['emi', 'interest', 'total']) set(name, '—');
      set('first-month', '');
      return;
    }
    const r = view.result;
    set('emi', formatInr(r.emi));
    set('interest', formatInr(r.totalInterest));
    set('total', formatInr(r.totalPayment));
    set(
      'first-month',
      s.firstMonth
        .replace('{interest}', formatInr(r.firstMonthInterest))
        .replace('{principal}', formatInr(r.firstMonthPrincipal)),
    );
    win.history.replaceState(null, '', toHash(state));
  };

  if (win.location.hash.length > 1) write(fromHash(win.location.hash));
  form.addEventListener('input', render);
  form.addEventListener('change', render);
  render();

  const share = doc.querySelector<HTMLButtonElement>('#emi-share');
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
