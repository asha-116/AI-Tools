import { describe, expect, it } from 'vitest';
import {
  bannedPhrases,
  competitorMentions,
  externalLinks,
  fakeUrgency,
  personTags,
  sensitiveTopics,
  unverifiedNumbers,
  wordCount,
} from '../src/policy.js';

describe('bannedPhrases', () => {
  it.each([
    'Guaranteed approval',
    'The best EMI tool',
    'Official stamp duty rates',
    'Officially correct',
    'The #1 calculator',
    '100% गारंटी',
    'सबसे बेस्ट टूल',
    'सर्वश्रेष्ठ कैलकुलेटर',
    'आधिकारिक दरें',
    'Earn ₹50,000 a month',
    'make more money with this',
    'Build passive income',
    'get rich with property',
    'हर महीने कमाई करें',
  ])('flags %s', (text) => {
    expect(bannedPhrases(text).length).toBeGreaterThan(0);
  });

  it.each([
    'Work out the EMI for your buyer.',
    'Commission split between you and a co-broker.',
    'स्टांप ड्यूटी का अनुमान लगाएँ।',
    'Bestow is not a banned word.',
  ])('allows %s', (text) => {
    expect(bannedPhrases(text)).toEqual([]);
  });
});

describe('fakeUrgency / competitors / topics / tags', () => {
  it('flags urgency in EN and HI', () => {
    expect(fakeUrgency('Hurry, limited time!')).toHaveLength(1);
    expect(fakeUrgency('जल्दी करें, आज ही!')).toHaveLength(1);
    expect(fakeUrgency('Try it on your next site visit.')).toEqual([]);
  });

  it('flags competitor names', () => {
    expect(competitorMentions('Better than MagicBricks')).toEqual([
      'mentions competitor "MagicBricks"',
    ]);
    expect(competitorMentions('Our calculator')).toEqual([]);
  });

  it('flags news, politics and regulation changes', () => {
    expect(sensitiveTopics('The minister announced a new rule')).toHaveLength(1);
    expect(sensitiveTopics('चुनाव से पहले')).toHaveLength(1);
    expect(sensitiveTopics('How EMI works')).toEqual([]);
  });

  it('finds @tags but not emails', () => {
    expect(personTags('Thanks @ramesh_k and @brand.in')).toEqual([
      'tags @ramesh_k',
      'tags @brand.in',
    ]);
    expect(personTags('mail help@example.com')).toEqual([]);
  });
});

describe('externalLinks', () => {
  it('allows only our own site', () => {
    expect(
      externalLinks(
        'See https://tools.changelense.in/tools/emi/, https://tools.changelense.in and https://changelense.in/x.',
      ),
    ).toEqual(['https://changelense.in/x']);
    expect(externalLinks('http://evil.example/a')).toEqual(['http://evil.example/a']);
  });
});

describe('unverifiedNumbers', () => {
  const allowed = [1_000_000, 13_493, 10.5, 100];

  it('accepts numbers the tool computed, in any notation', () => {
    expect(unverifiedNumbers('₹10,00,000 at 10.5% gives ₹13,493 (100%)', allowed)).toEqual([]);
    expect(unverifiedNumbers('a 10 lakh loan, Rs. 13493 a month', allowed)).toEqual([]);
    expect(unverifiedNumbers('10 लाख का लोन', allowed)).toEqual([]);
    expect(unverifiedNumbers('0.1 crore', allowed)).toEqual([]);
  });

  it('rejects invented amounts and rates', () => {
    expect(unverifiedNumbers('EMI of ₹21,696 at 8.5%', allowed)).toEqual([
      '"₹21,696" is not a number computed by the tool',
      '"8.5%" is not a number computed by the tool',
    ]);
    expect(unverifiedNumbers('2 करोड़', allowed)).toHaveLength(1);
    expect(unverifiedNumbers('INR 5 lac', allowed)).toHaveLength(1);
  });

  it('ignores plain counts', () => {
    expect(unverifiedNumbers('Step 1 of 3, 12 months', allowed)).toEqual([]);
  });
});

describe('wordCount', () => {
  it('counts Hindi and English words, not punctuation', () => {
    expect(wordCount('EMI की गणना — आसान है।')).toBe(5);
    expect(wordCount('  one  two\nthree - ')).toBe(3);
  });
});
