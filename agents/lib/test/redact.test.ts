import { describe, expect, it } from 'vitest';
import { containsPii, findCuedNames, redact, restore } from '../src/redact.js';

// All personal data below is invented. Card numbers are well-known public test numbers.

/** Redacted text must equal `expected`; restore() must give back the input exactly. */
function check(input: string, expected: string, names?: string[]): void {
  const r = redact(input, names ? { names } : {});
  expect(r.text).toBe(expected);
  expect(restore(r.text, r.map)).toBe(input);
}

/** Text that must come through unchanged. */
function keep(input: string): void {
  const r = redact(input);
  expect(r.text).toBe(input);
  expect(r.map).toEqual({});
}

describe('redact — emails', () => {
  it('plain email', () => check('mail me at rahul.sharma@gmail.com', 'mail me at [EMAIL_1]'));
  it('plus-addressing and subdomain', () => check('a+b@mail.example.co.in, ok', '[EMAIL_1], ok'));
  it('two different emails are numbered', () => check('x1@a.com y2@b.org', '[EMAIL_1] [EMAIL_2]'));
  it('same email (any case) keeps the same placeholder', () => {
    const r = redact('A@B.com then a@b.com');
    expect(r.text).toBe('[EMAIL_1] then [EMAIL_1]');
    expect(r.counts.EMAIL).toBe(1);
  });
});

describe('redact — Indian phone numbers', () => {
  it('+91 with spaces', () => check('call +91 98765 43210 now', 'call [PHONE_1] now'));
  it('+91 with dash', () => check('ph: +91-9876543210', 'ph: [PHONE_1]'));
  it('0 prefix', () => check('09876543210', '[PHONE_1]'));
  it('bare 10 digits starting 6', () => check('number 6123456789.', 'number [PHONE_1].'));
  it('5-5 with dash', () => check('98765-43210', '[PHONE_1]'));
  it('(+91) in brackets', () => check('(+91) 98765 43210', '[PHONE_1]'));
  it('0091 international prefix', () => check('0091 9876543210', '[PHONE_1]'));
  it('same number in two formats keeps one placeholder', () => {
    const r = redact('+91 98765 43210 or 9876543210');
    expect(r.text).toBe('[PHONE_1] or [PHONE_1]');
  });
  it('does not treat 10 digits starting 1–5 as a phone', () => keep('ref 5123456789'));
  it('does not cut a phone out of a longer digit run', () => {
    expect(redact('id 123498765432101').text).not.toContain('PHONE');
  });
  it('Devanagari digits', () => check('फ़ोन ९८७६५ ४३२१०', 'फ़ोन [PHONE_1]'));
});

describe('redact — payment and government identifiers', () => {
  it('Razorpay payment, order, refund, settlement, payment-link ids', () =>
    check(
      'pay_29QQoUBi66xm2f order_DBJOWzybf0sJbb rfnd_FP8QHiV938haTz setl_DGlQ1Rj8os78Ne plink_ExjpAUN3gVHrPJ',
      '[RAZORPAY_ID_1] [RAZORPAY_ID_2] [RAZORPAY_ID_3] [RAZORPAY_ID_4] [RAZORPAY_ID_5]',
    ));
  it('UPI id', () => check('UPI: rahul123@okaxis', 'UPI: [UPI_1]'));
  it('UPI id with dots and phone handle', () => check('pay 9876543210@ybl', 'pay [UPI_1]'));
  it('email is not mistaken for UPI', () => check('x@okaxis.com', '[EMAIL_1]'));
  it('PAN', () => check('PAN ABCDE1234F', 'PAN [PAN_1]'));
  it('PAN in lower case', () => check('pan abcde1234f', 'pan [PAN_1]'));
  it('GSTIN (contains a PAN) is one placeholder', () =>
    check('GSTIN 27ABCDE1234F1Z5', 'GSTIN [GSTIN_1]'));
  it('IFSC', () => check('IFSC SBIN0001234', 'IFSC [IFSC_1]'));
  it('Aadhaar with spaces', () => check('Aadhaar 2345 6789 0123', 'Aadhaar [AADHAAR_1]'));
  it('Aadhaar contiguous', () => check('234567890123', '[AADHAAR_1]'));
  it('Aadhaar starting with 9 is not a phone', () => check('9876 5432 1098', '[AADHAAR_1]'));
  it('card 4-4-4-4 with spaces', () => check('card 4111 1111 1111 1111', 'card [CARD_1]'));
  it('card with dashes', () => check('5500-0000-0000-0004', '[CARD_1]'));
  it('card contiguous 16 digits', () => check('4111111111111111', '[CARD_1]'));
  it('Amex 4-6-5', () => check('3782 822463 10005', '[CARD_1]'));
});

describe('redact — addresses with a PIN code', () => {
  it('labelled address keeps the label', () =>
    check('Address: Flat 12, Shanti Nagar, Pune 411001. Thanks', 'Address: [ADDRESS_1]. Thanks'));
  it('address line with commas', () =>
    check('12, MG Road, Bengaluru, Karnataka 560 001', '[ADDRESS_1]'));
  it('Hindi address', () => check('पता: मकान 5, गांधी नगर, जयपुर 302015', 'पता: [ADDRESS_1]'));
  it('only the address line is touched', () =>
    check('Hello\nH.No 4, Sector 21, Noida 201301\nBye', 'Hello\n[ADDRESS_1]\nBye'));
  it('a six-digit number without address words is kept', () => keep('OTP was 482913 today'));
});

describe('redact — names', () => {
  it('"my name is"', () =>
    check(
      'Hi, my name is Rahul Sharma and I need a refund',
      'Hi, my name is [NAME_1] and I need a refund',
    ));
  it('"my name is" in lower case stops at stop-words', () =>
    check('my name is priya and i paid', 'my name is [NAME_1] and i paid'));
  it('"Name:" field', () => check('Name: Sunita Devi\nCity: Pune', 'Name: [NAME_1]\nCity: Pune'));
  it('signature after "Regards,"', () =>
    check('Please help.\nRegards,\nAmit Kumar', 'Please help.\nRegards,\n[NAME_1]'));
  it('"Thanks for" is not a name', () => keep('Thanks for the quick reply'));
  it('later mentions of a cued name are also removed', () => {
    const r = redact('My name is Rahul Sharma. Rahul here again.');
    expect(r.text).toBe('My name is [NAME_1]. [NAME_2] here again.');
    expect(restore(r.text, r.map)).toBe('My name is Rahul Sharma. Rahul here again.');
  });
  it('names from a provided list, any case, share one placeholder', () => {
    const r = redact('Dear neha gupta, Neha Gupta paid', { names: ['Neha Gupta'] });
    expect(r.text).toBe('Dear [NAME_1], [NAME_1] paid');
    // restore() uses the first spelling seen.
    expect(restore(r.text, r.map)).toBe('Dear neha gupta, neha gupta paid');
  });
  it('initials stay part of the name', () => check('Name: R. K. Sharma', 'Name: [NAME_1]'));
  it('a provided name inside another word is kept', () =>
    check('Ravi bought a Ravioli', '[NAME_1] bought a Ravioli', ['Ravi']));
  it('Hindi "मेरा नाम … है"', () => check('मेरा नाम राहुल शर्मा है', 'मेरा नाम [NAME_1] है'));
  it('Hindi "नाम:"', () => check('नाम: सुनीता देवी, शहर: पुणे', 'नाम: [NAME_1], शहर: पुणे'));
  it('Hindi "मैं … बोल रहा हूँ"', () =>
    check('नमस्ते, मैं अमित बोल रहा हूँ', 'नमस्ते, मैं [NAME_1] बोल रहा हूँ'));
  it('Hinglish "mera naam … hai"', () =>
    check('mera naam Vikas Yadav hai', 'mera naam [NAME_1] hai'));
  it('findCuedNames lists cued names only', () => {
    expect(findCuedNames('this is Anil from Pune. Regards, Team')).toEqual(['Anil']);
  });
});

describe('redact — things that must survive', () => {
  it('rupee amounts in Indian grouping', () => keep('Price ₹1,00,000 and ₹ 2,50,000.50'));
  it('large rupee amount without commas', () => keep('Paid ₹9876543210 total'));
  it('Rs. amount', () => keep('Rs. 9876543210 only'));
  it('ISO and Indian dates', () => keep('On 2026-10-06 and 06-10-2026 and 06/10/2026'));
  it('two dates side by side are not a card', () => keep('06-10-2026 07-10-2026'));
  it('times, percentages and section numbers', () => keep('10:30 am, 18% GST, Section 80C'));
  it('plain English and Hindi sentences', () =>
    keep('स्टांप ड्यूटी कितनी है? What is the stamp duty in Maharashtra?'));
  it('placeholders from an earlier pass are not re-redacted', () => {
    const first = redact('Name: Rahul Kumar, rahul@x.com');
    const second = redact(first.text, { map: first.map });
    expect(second.text).toBe(first.text);
  });
});

describe('redact — full Hindi / mixed messages', () => {
  it('Hindi support message', () => {
    const input =
      'नमस्ते, मेरा नाम पूजा वर्मा है। फ़ोन 98765 43210, ईमेल pooja.v@yahoo.in. ' +
      'ऑर्डर order_DBJOWzybf0sJbb के लिए ₹499 दिए।';
    const r = redact(input);
    expect(r.text).toBe(
      'नमस्ते, मेरा नाम [NAME_1] है। फ़ोन [PHONE_1], ईमेल [EMAIL_1]. ' +
        'ऑर्डर [RAZORPAY_ID_1] के लिए ₹499 दिए।',
    );
    expect(r.counts).toEqual({ NAME: 1, PHONE: 1, EMAIL: 1, RAZORPAY_ID: 1 });
    expect(restore(r.text, r.map)).toBe(input);
  });

  it('English support e-mail with a signature', () => {
    const input =
      'From: Karan Mehta\nHi, I paid via UPI karan.m@oksbi (pay_29QQoUBi66xm2f) but no download.\n' +
      'Call 9123456789.\nThanks,\nKaran';
    const r = redact(input);
    expect(r.text).not.toMatch(/Karan|oksbi|pay_|9123456789/);
    expect(restore(r.text, r.map)).toBe(input);
  });
});

describe('map continuation, restore and containsPii', () => {
  it('continues numbering from an existing map', () => {
    const a = redact('a@x.com');
    const b = redact('b@y.com and a@x.com', { map: a.map });
    expect(b.text).toBe('[EMAIL_2] and [EMAIL_1]');
    expect(b.counts).toEqual({ EMAIL: 1 });
    expect(a.map).toEqual({ '[EMAIL_1]': 'a@x.com' }); // input map is not mutated
  });
  it('ignores foreign keys in a supplied map', () => {
    const r = redact('a@x.com', { map: { note: 'x' } });
    expect(r.text).toBe('[EMAIL_1]');
  });
  it('restore fills an LLM reply and leaves unknown placeholders', () => {
    const { map } = redact('Name: Asha Rao');
    expect(restore('Dear [NAME_1], see [LINK_1].', map)).toBe('Dear Asha Rao, see [LINK_1].');
  });
  it('restore resolves an address that contains a phone placeholder', () => {
    const input = 'Address: Plot 7, 9876543210, Andheri, Mumbai 400053';
    const r = redact(input);
    expect(r.text).toBe('Address: [ADDRESS_1]');
    expect(restore(r.text, r.map)).toBe(input);
  });
  it('containsPii', () => {
    expect(containsPii('call 9876543210')).toBe(true);
    expect(containsPii('price ₹1,00,000')).toBe(false);
    expect(containsPii('hi Meera', { names: ['Meera'] })).toBe(true);
  });
});
