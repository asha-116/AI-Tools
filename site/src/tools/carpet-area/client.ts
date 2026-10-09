import {
  evaluate,
  formatInr,
  formatNumber,
  formatPercent,
  fromHash,
  SQ_M_PER_SQ_FT,
  toHash,
  type CarpetField,
  type CarpetFormState,
} from './logic.js';

interface ClientStrings {
  share: string;
  shareCopied: string;
  sqFt: string;
  sqM: string;
}

const FIELDS: Array<keyof CarpetFormState> = [
  'superBuiltUp',
  'carpet',
  'loading',
  'loadingBase',
  'priceMode',
  'priceValue',
];
const CHECKED: CarpetField[] = ['superBuiltUp', 'carpet', 'loading', 'priceValue'];

/** Wires the carpet-area form: live results, inline errors, shareable hash link. No network calls. */
export function initCarpetArea(doc: Document, win: Window): void {
  const form = doc.querySelector<HTMLFormElement>('#carpet-form');
  if (!form) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const control = (name: keyof CarpetFormState) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  const set = (name: string, text: string) => {
    const el = doc.querySelector<HTMLElement>(`[data-out="${name}"]`);
    if (el) el.textContent = text;
  };
  const show = (name: string, visible: boolean) => {
    const el = doc.querySelector<HTMLElement>(`[data-row="${name}"]`);
    if (el) el.hidden = !visible;
  };
  const area = (sqFt: number) =>
    `${formatNumber(sqFt)} ${s.sqFt} (${formatNumber(sqFt * SQ_M_PER_SQ_FT)} ${s.sqM})`;

  const read = (): CarpetFormState =>
    Object.fromEntries(FIELDS.map((f) => [f, control(f).value])) as unknown as CarpetFormState;

  const render = () => {
    const state = read();
    const view = evaluate(state);
    for (const f of CHECKED) {
      const bad = !view.ok && view.errors.includes(f);
      control(f).setAttribute('aria-invalid', String(bad));
      const msg = doc.querySelector<HTMLElement>(`[data-error="${f}"]`);
      if (msg) msg.hidden = !bad;
    }
    if (!view.ok) {
      for (const n of ['carpet-rate', 'loading', 'carpet', 'common', 'share', 'total', 'sba-rate'])
        set(n, '—');
      return;
    }
    const r = view.result;
    const priced = r.ratePerCarpet !== undefined;
    set('carpet-rate', priced ? formatInr(r.ratePerCarpet ?? 0) : '—');
    set('loading', formatPercent(r.loadingOnCarpetPercent));
    set('carpet', area(r.carpet));
    set('common', area(r.commonArea));
    set('share', formatPercent(r.commonSharePercent));
    set('total', priced ? formatInr(r.totalPrice ?? 0) : '—');
    set('sba-rate', priced ? formatInr(r.ratePerSuperBuiltUp ?? 0) : '—');
    show('carpet-rate', priced);
    show('total', priced);
    show('sba-rate', priced);
    win.history.replaceState(null, '', toHash(state));
  };

  if (win.location.hash.length > 1) {
    const state = fromHash(win.location.hash);
    for (const f of FIELDS) control(f).value = state[f];
  }
  form.addEventListener('input', render);
  form.addEventListener('change', render);
  render();

  const share = doc.querySelector<HTMLButtonElement>('#carpet-share');
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
