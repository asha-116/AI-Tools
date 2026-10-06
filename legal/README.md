# Legal pages

Razorpay requires these pages before live mode. Every file here is **owner-approved only**
(`type:legal`, `approved-by-owner`). Privacy text must address India's Digital Personal Data
Protection Act, 2023. Drafts are not legal advice — the owner should have them reviewed by a lawyer
(and the tax parts by a CA). **No site pages exist yet**; publishing needs owner approval.

## Files

| Page    | English                  | Hindi                          | Status                                           |
| ------- | ------------------------ | ------------------------------ | ------------------------------------------------ |
| Terms   | [terms.md](terms.md)     | [terms.hi.md](terms.hi.md)     | Draft — needs owner + lawyer                     |
| Privacy | [privacy.md](privacy.md) | [privacy.hi.md](privacy.hi.md) | Draft — needs owner + lawyer                     |
| Refund  | [refund.md](refund.md)   | [refund.hi.md](refund.hi.md)   | Draft — from `company/policies/refund-policy.md` |
| Contact | [contact.md](contact.md) | [contact.hi.md](contact.hi.md) | Draft — needs owner details                      |

All Hindi files also need review by a fluent human reader (`<!-- Hindi draft: needs human review -->`).

## Owner checklist

### Fill in (placeholders, in square brackets in every file)

- [ ] `[BUSINESS NAME]`
- [ ] `[OWNER / PROPRIETOR NAME]`
- [ ] `[REGISTERED ADDRESS]`
- [ ] `[SUPPORT EMAIL]`
- [ ] `[PHONE (optional)]` — or remove the line
- [ ] `[GRIEVANCE OFFICER NAME]` (can be the owner)
- [ ] `[GSTIN if registered]` — or remove the line
- [ ] `[JURISDICTION CITY]`
- [ ] `[EFFECTIVE DATE]`

### Decide (marked _(proposal)_ in the files)

- [ ] Retention: waitlist until removal requested or idea dropped; order records [8] years (confirm
      with CA); support emails [12] months.
- [ ] Response times: reply within [2] working days; rights requests and grievances resolved within
      [30] days.
- [ ] Refund timelines: start within [2] working days of approval; bank shows it in [5–7] working
      days.
- [ ] Template licence: buyer's own work/business use; no resale or redistribution of the file.
- [ ] Liability cap: limited to the amount paid.
- [ ] Prices shown inclusive of all taxes (GST treatment to be confirmed with a CA).
- [ ] Whether Cloudflare Web Analytics is turned on (privacy says "may use").

### Before publishing

- [ ] Lawyer review of all four pages (EN + HI); CA review of tax/retention points.
- [ ] Human review of the Hindi text.
- [ ] Check Razorpay's current website/policy requirements for live mode.
- [ ] Re-check the privacy page against the code if `workers/` change what they store.
- [ ] Bump `CONSENT_VERSION` in `workers/waitlist` if the waitlist consent text changes to link the
      final privacy page.
