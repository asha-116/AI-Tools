import { describe, expect, it } from 'vitest';
import { ideas } from '../src/i18n/ideas.js';
import { ideaFromSearch } from '../src/lib/templates.js';
import { errorMessageFor } from '../src/scripts/waitlist.js';

const s = {
  sending: 'sending',
  success: 'success',
  errorGeneric: 'generic',
  errorEmail: 'email',
  errorConsent: 'consent',
  errorRate: 'rate',
  submit: 'submit',
};

describe('errorMessageFor', () => {
  it.each([
    [undefined, 429, 'rate'],
    ['invalid_email', 400, 'email'],
    ['consent_required', 400, 'consent'],
    ['invalid_idea', 400, 'generic'],
    [undefined, 500, 'generic'],
  ])('%s / %d → %s', (code, status, expected) => {
    expect(errorMessageFor(code, status, s)).toBe(expected);
  });
});

describe('ideaFromSearch', () => {
  const known = ideas.map((i) => i.id);

  it.each([
    ['?idea=lead-tracker', 'lead-tracker'],
    ['?idea=commission-ledger', 'commission-ledger'],
    ['idea=stamp-duty', 'stamp-duty'],
    ['?utm_source=x&idea=lead-tracker', 'lead-tracker'],
  ])('%s → %s', (search, expected) => {
    expect(ideaFromSearch(search, known)).toBe(expected);
  });

  it.each([
    [''],
    ['?'],
    ['?idea='],
    ['?idea=bundle'],
    ['?idea=Lead-Tracker'],
    ['?idea=lead-tracker%22%5D'],
    ['?ideas=lead-tracker'],
  ])('%s → null (default choice stays)', (search) => {
    expect(ideaFromSearch(search, known)).toBeNull();
  });

  it('returns null when the form has no radios (waitlist closed)', () => {
    expect(ideaFromSearch('?idea=lead-tracker', [])).toBeNull();
  });
});
