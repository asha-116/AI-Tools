import { COMMISSION_LIMITS } from '@toolshop/tools-core';
import { formatInrExact } from '../../lib/format.js';
import {
  defaultState,
  evaluate,
  fromHash,
  sharesTotal,
  toHash,
  type CommissionFormState,
} from './logic.js';

interface ClientStrings {
  sharesTotal: string;
  share: string;
  shareCopied: string;
  defaults: [string, string];
}

/** Wires the commission form. No network calls; state lives in the URL hash. */
export function initCommission(doc: Document, win: Window): void {
  const form = doc.querySelector<HTMLFormElement>('#cm-form');
  const list = doc.querySelector<HTMLOListElement>('#cm-parties');
  const template = doc.querySelector<HTMLTemplateElement>('#cm-party-template');
  const addBtn = doc.querySelector<HTMLButtonElement>('#cm-add');
  if (!form || !list || !template || !addBtn) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const input = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  const out = (name: string) => doc.querySelector<HTMLElement>(`[data-out="${name}"]`);

  const read = (): CommissionFormState => ({
    mode:
      form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value === 'fixed'
        ? 'fixed'
        : 'percent',
    deal: input('deal')?.value ?? '',
    rate: input('rate')?.value ?? '',
    amount: input('amount')?.value ?? '',
    gst: input('gst')?.value ?? '',
    parties: [...list.querySelectorAll('li')].map((li) => ({
      label: li.querySelector<HTMLInputElement>('input[name="label"]')?.value ?? '',
      share: li.querySelector<HTMLInputElement>('input[name="share"]')?.value ?? '',
    })),
  });

  const addRow = (label: string, share: string) => {
    const frag = template.content.cloneNode(true) as DocumentFragment;
    const li = frag.querySelector('li');
    if (!li) return;
    const [labelInput, shareInput] = li.querySelectorAll('input');
    if (labelInput) labelInput.value = label;
    if (shareInput) shareInput.value = share;
    list.append(li);
  };

  const write = (state: CommissionFormState) => {
    const radio = form.querySelector<HTMLInputElement>(`input[name="mode"][value="${state.mode}"]`);
    if (radio) radio.checked = true;
    for (const key of ['deal', 'rate', 'amount', 'gst'] as const) {
      const el = input(key);
      if (el) el.value = state[key];
    }
    list.replaceChildren();
    for (const p of state.parties) addRow(p.label, p.share);
  };

  const render = () => {
    const state = read();
    for (const el of form.querySelectorAll<HTMLElement>('[data-mode]')) {
      el.hidden = el.dataset['mode'] !== state.mode;
    }
    const count = state.parties.length;
    addBtn.disabled = count >= COMMISSION_LIMITS.maxParties;
    for (const b of list.querySelectorAll<HTMLButtonElement>('[data-remove]'))
      b.disabled = count <= 1;

    const total = sharesTotal(state.parties);
    const totalEl = out('shares-total');
    if (totalEl) totalEl.textContent = s.sharesTotal.replace('{total}', String(+total.toFixed(4)));

    const view = evaluate(state);
    for (const key of ['deal', 'rate', 'amount', 'gst', 'shares'] as const) {
      const bad = !view.ok && view.errors.includes(key);
      const msg = doc.querySelector<HTMLElement>(`[data-error="${key}"]`);
      if (msg) msg.hidden = !bad;
      if (key === 'shares') {
        for (const el of list.querySelectorAll('input[name="share"]')) {
          el.setAttribute('aria-invalid', String(bad));
        }
      } else input(key)?.setAttribute('aria-invalid', String(bad));
    }

    const set = (name: string, text: string) => {
      const el = out(name);
      if (el) el.textContent = text;
    };
    const split = out('split');
    if (!view.ok) {
      for (const name of ['gross', 'gst', 'total']) set(name, '—');
      split?.replaceChildren();
      return;
    }
    const r = view.result;
    set('gross', formatInrExact(r.gross));
    set('gst', formatInrExact(r.gst));
    set('total', formatInrExact(r.totalPayable));
    split?.replaceChildren(
      ...r.parties.map((p) => {
        const li = doc.createElement('li');
        const name = doc.createElement('span');
        name.textContent = `${p.label} (${String(p.percent)}%)`; // textContent: labels are user text
        const amt = doc.createElement('strong');
        amt.textContent = formatInrExact(p.amount);
        li.append(name, amt);
        return li;
      }),
    );
    win.history.replaceState(null, '', toHash(state));
  };

  if (win.location.hash.length > 1) {
    write(fromHash(win.location.hash, defaultState(s.defaults)));
  }
  form.addEventListener('input', render);
  form.addEventListener('change', render);
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-remove]');
    if (btn && list.children.length > 1) {
      btn.closest('li')?.remove();
      render();
    }
  });
  addBtn.addEventListener('click', () => {
    if (list.children.length >= COMMISSION_LIMITS.maxParties) return;
    addRow('', '0');
    render();
    list.querySelector<HTMLInputElement>('li:last-child input[name="label"]')?.focus();
  });
  render();

  const shareBtn = doc.querySelector<HTMLButtonElement>('#cm-share');
  shareBtn?.addEventListener('click', () => {
    const url = win.location.href;
    win.navigator.clipboard.writeText(url).then(
      () => {
        shareBtn.textContent = s.shareCopied;
        win.setTimeout(() => (shareBtn.textContent = s.share), 2000);
      },
      () => {
        win.prompt(s.share, url);
      },
    );
  });
}
