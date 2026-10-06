import type { BuyerGender, StateRates } from '@toolshop/tools-core';
import { formatInr } from '../../lib/format.js';
import {
  evaluate,
  fromHash,
  localizeResult,
  toHash,
  visibleStates,
  type SdFormState,
} from './logic.js';

interface ClientStrings {
  resultRule: string;
  lastVerified: string;
  share: string;
  shareCopied: string;
  stampDuty: string;
  registration: string;
  draftSuffix: string;
  lang: 'en' | 'hi';
}

/** Wires the stamp duty form. Rates come from the embedded JSON; no network calls. */
export function initStampDuty(doc: Document, win: Window): void {
  const form = doc.querySelector<HTMLFormElement>('#sd-form');
  const dataEl = doc.querySelector('#sd-data');
  if (!form || !dataEl) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const all = JSON.parse(dataEl.textContent || '[]') as StateRates[];
  const fromUrl = fromHash(win.location.hash);
  const showDrafts = fromUrl.showDrafts;
  const states = visibleStates(all, showDrafts);
  if (states.length === 0) return; // the "coming soon" note stays visible

  const byId = <T extends HTMLElement>(id: string) => doc.querySelector<T>(`#${id}`);
  const stateSel = byId<HTMLSelectElement>('sd-state');
  const areaSel = byId<HTMLSelectElement>('sd-area');
  const areaField = byId<HTMLElement>('sd-area-field');
  const valueIn = byId<HTMLInputElement>('sd-value');
  if (!stateSel || !areaSel || !areaField || !valueIn) return;

  const setText = (el: Element | null, v: string) => {
    if (el) el.textContent = v;
  };
  const option = (value: string, label: string) => {
    const o = doc.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  };
  const stateName = (st: StateRates) =>
    s.lang === 'hi' && st.state_name_hi ? st.state_name_hi : st.state;

  if (showDrafts) {
    byId('sd-draft-banner')?.removeAttribute('hidden');
    byId('sd-coming-soon')?.setAttribute('hidden', '');
    byId('sd-app')?.removeAttribute('hidden');
    stateSel.replaceChildren(
      ...states.map((st) =>
        option(st.state_code, stateName(st) + (st.status === 'draft' ? s.draftSuffix : '')),
      ),
    );
  }

  const fillAreas = (keep?: string) => {
    const st = states.find((x) => x.state_code === stateSel.value);
    const areas = st?.areas ?? [];
    areaField.hidden = areas.length === 0;
    areaSel.replaceChildren(
      ...areas.map((a) => option(a.id, s.lang === 'hi' ? a.label_hi : a.label_en)),
    );
    if (keep && areas.some((a) => a.id === keep)) areaSel.value = keep;
  };

  const read = (): SdFormState => ({
    state: stateSel.value,
    area: areaSel.value,
    buyer: (form.querySelector<HTMLInputElement>('input[name="buyer"]:checked')?.value ??
      'male') as BuyerGender,
    value: valueIn.value,
  });

  const listItem = (child: Node | string) => {
    const li = doc.createElement('li');
    li.append(child);
    return li;
  };

  const render = () => {
    const f = read();
    const view = evaluate(states, f);
    const badValue = !view.ok && view.error === 'value';
    valueIn.setAttribute('aria-invalid', String(badValue));
    const err = form.querySelector<HTMLElement>('[data-error="value"]');
    if (err) err.hidden = !badValue;
    const lines = byId('sd-lines');
    if (!view.ok) {
      lines?.replaceChildren();
      setText(doc.querySelector('[data-out="total"]'), '—');
      return;
    }
    const { result: r, data } = view;
    const text = localizeResult(r, s.lang);
    const row = (label: string, amount: number) => {
      const div = doc.createElement('div');
      const dt = doc.createElement('dt');
      dt.textContent = label;
      const dd = doc.createElement('dd');
      dd.textContent = formatInr(amount);
      div.append(dt, dd);
      return div;
    };
    lines?.replaceChildren(
      row(s.stampDuty, r.stampDuty),
      ...text.surcharges.map((x) => row(x.name, x.amount)),
      row(s.registration, r.registration),
    );
    setText(doc.querySelector('[data-out="total"]'), formatInr(r.total));
    setText(doc.querySelector('[data-out="rule"]'), s.resultRule.replace('{rule}', text.rule));
    setText(
      doc.querySelector('[data-out="verified"]'),
      s.lastVerified.replace('{date}', data.last_verified),
    );

    byId('sd-sources')?.replaceChildren(
      ...data.sources.map((src) => {
        const a = doc.createElement('a');
        a.href = src.url;
        a.rel = 'noopener nofollow';
        a.textContent = src.title;
        return listItem(a);
      }),
    );
    const official = byId<HTMLAnchorElement>('sd-official');
    if (official) {
      official.href = data.official_source ?? '#';
      official.textContent = data.official_source ?? '';
    }
    const conflicts = byId('sd-conflicts');
    if (conflicts) {
      const list = data.conflicts ?? [];
      conflicts.hidden = !(showDrafts && list.length > 0);
      conflicts.querySelector('ul')?.replaceChildren(...list.map((c) => listItem(c)));
    }
    win.history.replaceState(null, '', toHash(f, showDrafts));
  };

  const f = fromUrl.form;
  if (f.state && states.some((x) => x.state_code === f.state)) stateSel.value = f.state;
  fillAreas(f.area);
  if (f.buyer) {
    const radio = form.querySelector<HTMLInputElement>(`input[name="buyer"][value="${f.buyer}"]`);
    if (radio) radio.checked = true;
  }
  if (f.value) valueIn.value = f.value;

  stateSel.addEventListener('change', () => {
    fillAreas();
    render();
  });
  form.addEventListener('input', render);
  form.addEventListener('change', render);
  render();

  const shareBtn = byId<HTMLButtonElement>('sd-share');
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
