import { describe, expect, it } from 'vitest';
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
