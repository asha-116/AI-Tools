/** Browser-side waitlist form handling. Kept framework-free and small. */

interface ClientStrings {
  sending: string;
  success: string;
  errorGeneric: string;
  errorEmail: string;
  errorConsent: string;
  errorRate: string;
  submit: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function errorMessageFor(
  code: string | undefined,
  status: number,
  s: ClientStrings,
): string {
  if (status === 429) return s.errorRate;
  if (code === 'invalid_email') return s.errorEmail;
  if (code === 'consent_required') return s.errorConsent;
  return s.errorGeneric;
}

export function initWaitlist(doc: Document): void {
  // "Notify me" on an idea card pre-selects that idea in the form.
  for (const link of doc.querySelectorAll<HTMLAnchorElement>('[data-pick-idea]')) {
    link.addEventListener('click', () => {
      const id = link.dataset['pickIdea'];
      const radio = doc.querySelector<HTMLInputElement>(`input[name="idea"][value="${id ?? ''}"]`);
      if (radio) radio.checked = true;
      doc.querySelector<HTMLInputElement>('#wl-email')?.focus({ preventScroll: true });
    });
  }

  const form = doc.querySelector<HTMLFormElement>('#waitlist-form');
  if (!form) return;
  const s = JSON.parse(form.dataset['strings'] ?? '{}') as ClientStrings;
  const status = form.querySelector<HTMLElement>('.status');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  const show = (msg: string, kind: 'ok' | 'error' | '') => {
    if (!status) return;
    status.textContent = msg;
    status.className = `status ${kind}`;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim();
    const consent = data.get('consent') === 'on';
    if (!EMAIL_RE.test(email)) return show(s.errorEmail, 'error');
    if (!consent) return show(s.errorConsent, 'error');

    if (button) {
      button.disabled = true;
      button.textContent = s.sending;
    }
    show('', '');
    fetch(form.dataset['endpoint'] ?? '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        idea: String(data.get('idea') ?? ''),
        lang: form.dataset['lang'],
        consent,
        website: String(data.get('website') ?? ''),
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          form.reset();
          show(s.success, 'ok');
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        show(errorMessageFor(body.error, res.status, s), 'error');
      })
      .catch(() => {
        show(s.errorGeneric, 'error');
      })
      .finally(() => {
        if (button) {
          button.disabled = false;
          button.textContent = s.submit;
        }
      });
  });
}
