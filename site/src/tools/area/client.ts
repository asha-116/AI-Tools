import { ALL_UNITS } from './data.js';
import { evaluate, formatArea, fromHash, toHash, visibleUnits } from './logic.js';

interface ClientStrings {
  share: string;
  shareCopied: string;
}

/** Wires the area form: live results, inline error, shareable hash link. No network calls. */
export function initArea(doc: Document, win: Window): void {
  const form = doc.querySelector<HTMLFormElement>('#area-form');
  if (!form) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const valueInput = form.elements.namedItem('value') as HTMLInputElement;
  const unitSelect = form.elements.namedItem('from') as HTMLSelectElement;

  const fromUrl = fromHash(win.location.hash);
  const showDrafts = fromUrl.showDrafts;
  const units = visibleUnits(ALL_UNITS, showDrafts);

  if (showDrafts) {
    for (const el of doc.querySelectorAll<HTMLElement>('[data-draft]')) {
      el.hidden = false;
      if (el instanceof HTMLOptionElement) el.disabled = false;
    }
    const note = doc.querySelector<HTMLElement>('[data-draft-note]');
    if (note) note.hidden = false;
  }
  if (win.location.hash.length > 1 && units.some((u) => u.id === fromUrl.state.from)) {
    valueInput.value = fromUrl.state.value;
    unitSelect.value = fromUrl.state.from;
  }

  const render = () => {
    const state = { value: valueInput.value, from: unitSelect.value };
    const view = evaluate(units, state);
    const bad = !view.ok && view.error === 'value';
    valueInput.setAttribute('aria-invalid', String(bad));
    const msg = doc.querySelector<HTMLElement>('[data-error="value"]');
    if (msg) msg.hidden = !bad;
    for (const u of units) {
      const out = doc.querySelector<HTMLElement>(`[data-out="${u.id}"]`);
      if (!out) continue;
      const row = view.ok ? view.rows.find((r) => r.id === u.id) : undefined;
      out.textContent = row ? formatArea(row.value) : '—';
    }
    if (view.ok) win.history.replaceState(null, '', toHash(state, showDrafts));
  };

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  render();

  const share = doc.querySelector<HTMLButtonElement>('#area-share');
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
