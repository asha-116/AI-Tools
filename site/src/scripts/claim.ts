/** Browser side of the "Get my download" page. Framework-free; text is set with textContent. */
import { formatExpiry, parseClaimResponse, validateClaim } from '../lib/claim.js';
import type { ClaimStrings } from '../i18n/claim.js';

type S = Pick<
  ClaimStrings,
  | 'submit'
  | 'sending'
  | 'linksNote'
  | 'errorPaymentId'
  | 'errorEmail'
  | 'errorNotFound'
  | 'errorNeedsSupport'
  | 'errorRate'
  | 'errorGeneric'
>;

export function initClaim(doc: Document): void {
  const form = doc.querySelector<HTMLFormElement>('#claim-form');
  if (!form) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as S;
  const lang = form.dataset['lang'] === 'hi' ? 'hi' : 'en';
  const endpoint = form.dataset['endpoint'] ?? '';
  let downloadOrigin = '';
  try {
    downloadOrigin = new URL(form.dataset['download'] ?? '').origin;
  } catch {
    // Misconfigured build: every response will be treated as an error.
  }
  const status = form.querySelector<HTMLElement>('.status');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const results = doc.querySelector<HTMLElement>('#claim-results');
  const list = results?.querySelector('ul');
  const note = results?.querySelector<HTMLElement>('[data-out="note"]');

  const show = (msg: string) => {
    if (status) status.textContent = msg;
  };
  const errors = {
    notFound: s.errorNotFound,
    needsSupport: s.errorNeedsSupport,
    rate: s.errorRate,
    generic: s.errorGeneric,
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const v = validateClaim(String(data.get('payment_id') ?? ''), String(data.get('email') ?? ''));
    if (!v.ok) return show(v.error === 'paymentId' ? s.errorPaymentId : s.errorEmail);

    show('');
    if (results) results.hidden = true;
    if (button) {
      button.disabled = true;
      button.textContent = s.sending;
    }
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_id: v.paymentId, email: v.email }),
    })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        const out = parseClaimResponse(res.status, body, downloadOrigin);
        if (!out.ok) return show(errors[out.error]);
        list?.replaceChildren(
          ...out.links.map((l) => {
            const li = doc.createElement('li');
            const a = doc.createElement('a');
            a.href = l.url;
            a.rel = 'noopener noreferrer';
            a.textContent = l.file;
            li.append(a);
            return li;
          }),
        );
        if (note)
          note.textContent = s.linksNote.replace('{date}', formatExpiry(out.expiresAt, lang));
        if (results) results.hidden = false;
      })
      .catch(() => {
        show(s.errorGeneric);
      })
      .finally(() => {
        if (button) {
          button.disabled = false;
          button.textContent = s.submit;
        }
      });
  });
}
