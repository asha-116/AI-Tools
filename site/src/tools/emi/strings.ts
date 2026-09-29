/** EMI calculator strings. `hi` must have exactly the keys of `en` (typecheck + site/test). */
const en = {
  metaTitle: 'EMI calculator — home, car and personal loans',
  metaDescription:
    'Calculate the monthly EMI, total interest and total payment for any loan. Shows the formula. Works on your phone; nothing you type leaves your device.',
  h1: 'EMI calculator',
  lead: 'Work out the monthly instalment for your buyer’s home loan in seconds. Everything is calculated on this device.',
  principalLabel: 'Loan amount (₹)',
  rateLabel: 'Interest rate (% per year)',
  tenureLabel: 'Loan tenure',
  unitYears: 'years',
  unitMonths: 'months',
  resultEmi: 'Monthly EMI',
  resultInterest: 'Total interest',
  resultTotal: 'Total payment (principal + interest)',
  resultFirstMonth: 'First EMI: interest {interest} + principal {principal}',
  errorPrincipal: 'Enter a loan amount between ₹1 and ₹100 crore.',
  errorRate: 'Enter an interest rate between 0% and 50%.',
  errorTenure: 'Enter a tenure between 1 month and 40 years.',
  share: 'Copy link to this result',
  shareCopied: 'Link copied',
  formulaTitle: 'How it is calculated',
  formulaWhere:
    'P = loan amount, r = yearly rate ÷ 12 ÷ 100 (monthly rate), n = number of monthly instalments.',
  assumptionsTitle: 'Assumptions',
  assumptions: [
    'The interest rate stays the same for the whole tenure.',
    'Interest is charged monthly on the outstanding balance (reducing balance).',
    'Processing fees, insurance, taxes and prepayments are not included.',
    'Amounts are rounded to the nearest rupee for display.',
  ],
  backHome: 'All tools',
};

export type EmiStrings = typeof en;

const hi: EmiStrings = {
  metaTitle: 'EMI कैलकुलेटर — होम, कार और पर्सनल लोन',
  metaDescription:
    'किसी भी लोन की मासिक EMI, कुल ब्याज और कुल भुगतान निकालें। फ़ॉर्मूला भी दिखता है। फ़ोन पर चलता है; आपका डाला गया कुछ भी आपके डिवाइस से बाहर नहीं जाता।',
  h1: 'EMI कैलकुलेटर',
  lead: 'अपने खरीदार के होम लोन की मासिक किस्त सेकंडों में निकालें। सारी गणना इसी डिवाइस पर होती है।',
  principalLabel: 'लोन राशि (₹)',
  rateLabel: 'ब्याज दर (% प्रति वर्ष)',
  tenureLabel: 'लोन की अवधि',
  unitYears: 'साल',
  unitMonths: 'महीने',
  resultEmi: 'मासिक EMI',
  resultInterest: 'कुल ब्याज',
  resultTotal: 'कुल भुगतान (मूलधन + ब्याज)',
  resultFirstMonth: 'पहली EMI: ब्याज {interest} + मूलधन {principal}',
  errorPrincipal: '₹1 से ₹100 करोड़ के बीच लोन राशि डालें।',
  errorRate: '0% से 50% के बीच ब्याज दर डालें।',
  errorTenure: '1 महीने से 40 साल के बीच अवधि डालें।',
  share: 'इस नतीजे का लिंक कॉपी करें',
  shareCopied: 'लिंक कॉपी हो गया',
  formulaTitle: 'गणना कैसे होती है',
  formulaWhere: 'P = लोन राशि, r = सालाना दर ÷ 12 ÷ 100 (मासिक दर), n = मासिक किस्तों की संख्या।',
  assumptionsTitle: 'मान्यताएँ',
  assumptions: [
    'पूरी अवधि में ब्याज दर एक जैसी रहती है।',
    'ब्याज हर महीने बकाया राशि पर लगता है (रिड्यूसिंग बैलेंस)।',
    'प्रोसेसिंग फ़ीस, बीमा, टैक्स और प्री-पेमेंट शामिल नहीं हैं।',
    'दिखाने के लिए राशि को नज़दीकी रुपये तक राउंड किया गया है।',
  ],
  backHome: 'सभी टूल',
};

export const emiStrings = { en, hi } as const;
