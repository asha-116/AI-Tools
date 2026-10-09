/** Home-loan eligibility calculator strings. `hi` must have exactly the keys of `en`. */
const en = {
  metaTitle: 'Home loan eligibility calculator: how much loan on your income',
  metaDescription:
    'Enter take-home income, existing EMIs and the bank’s FOIR limit to see the largest home loan and EMI your buyer can get. Runs on your phone.',
  h1: 'Home loan eligibility calculator',
  lead: 'How much home loan can your buyer get? Banks cap all EMIs at a share of take-home income (FOIR). Everything is calculated on this device.',
  incomeLegend: 'Income and EMIs',
  incomeLabel: 'Take-home income per month (₹)',
  coIncomeLabel: 'Co-applicant take-home income per month (₹, optional)',
  existingLabel: 'EMIs already being paid per month (₹)',
  foirLabel: 'Bank’s FOIR limit (% of income)',
  loanLegend: 'The new loan',
  rateLabel: 'Interest rate (% a year)',
  yearsLabel: 'Tenure (years)',
  priceLabel: 'Property price (₹, optional)',
  errorIncome: 'Enter a monthly income above ₹0.',
  errorCoIncome: 'Enter 0 or a positive amount.',
  errorExisting: 'Enter 0 or a positive amount.',
  errorFoir: 'Enter a limit above 0% and up to 100%.',
  errorRate: 'Enter a rate between 0% and 50%.',
  errorYears: 'Enter a tenure between 1 month and 40 years.',
  errorPrice: 'Enter 0 or a positive amount.',
  resultLoan: 'Largest loan',
  resultEmi: 'EMI for this loan',
  rowLimit: 'All EMIs allowed (FOIR limit)',
  rowExisting: 'Existing EMIs now use',
  rowDown: 'Own money needed for the property',
  noRoom:
    'Existing EMIs already use the whole FOIR limit, so no new loan fits. Close a loan, add a co-applicant or ask a bank with a higher limit.',
  share: 'Copy link to this result',
  shareCopied: 'Link copied',
  formulaTitle: 'How it is calculated',
  formulaWhere:
    'r = yearly rate ÷ 12 ÷ 100, n = months. The bracket is the EMI you can still take on; the loan is the amount whose EMI equals it.',
  assumptionsTitle: 'Assumptions',
  assumptions: [
    'FOIR limits differ by bank and by income (often 40% to 60% of take-home pay). Ask the bank for its limit.',
    'Banks also cap the loan at a share of the property value, and check credit score, age and job. The bank’s offer can be lower.',
    'Own money needed = property price − largest loan. Stamp duty, registration and fees are extra.',
    'The interest rate stays the same for the whole loan.',
  ],
  backHome: 'All tools',
};

export type EligibilityStrings = typeof en;

const hi: EligibilityStrings = {
  metaTitle: 'होम लोन पात्रता कैलकुलेटर: आपकी आय पर कितना लोन',
  metaDescription:
    'हाथ में आने वाली आय, चल रही EMI और बैंक की FOIR सीमा डालें और देखें कि आपके खरीदार को कितना बड़ा होम लोन और कितनी EMI मिल सकती है। आपके फ़ोन पर चलता है।',
  h1: 'होम लोन पात्रता कैलकुलेटर',
  lead: 'आपके खरीदार को कितना होम लोन मिल सकता है? बैंक सभी EMI को हाथ में आने वाली आय के एक हिस्से (FOIR) तक सीमित रखते हैं। सारी गणना इसी डिवाइस पर होती है।',
  incomeLegend: 'आय और EMI',
  incomeLabel: 'हर महीने हाथ में आने वाली आय (₹)',
  coIncomeLabel: 'सह-आवेदक की हर महीने हाथ में आने वाली आय (₹, वैकल्पिक)',
  existingLabel: 'हर महीने पहले से चल रही EMI (₹)',
  foirLabel: 'बैंक की FOIR सीमा (आय का %)',
  loanLegend: 'नया लोन',
  rateLabel: 'ब्याज दर (% सालाना)',
  yearsLabel: 'अवधि (साल)',
  priceLabel: 'प्रॉपर्टी की कीमत (₹, वैकल्पिक)',
  errorIncome: '₹0 से ज़्यादा मासिक आय डालें।',
  errorCoIncome: '0 या कोई धनात्मक राशि डालें।',
  errorExisting: '0 या कोई धनात्मक राशि डालें।',
  errorFoir: '0% से ज़्यादा और 100% तक की सीमा डालें।',
  errorRate: '0% से 50% के बीच दर डालें।',
  errorYears: '1 महीने से 40 साल के बीच अवधि डालें।',
  errorPrice: '0 या कोई धनात्मक राशि डालें।',
  resultLoan: 'सबसे बड़ा लोन',
  resultEmi: 'इस लोन की EMI',
  rowLimit: 'कुल EMI की सीमा (FOIR)',
  rowExisting: 'चल रही EMI अभी इतनी आय लेती हैं',
  rowDown: 'प्रॉपर्टी के लिए अपना पैसा',
  noRoom:
    'चल रही EMI पहले ही पूरी FOIR सीमा ले रही हैं, इसलिए नया लोन नहीं बनता। कोई लोन बंद करें, सह-आवेदक जोड़ें या ज़्यादा सीमा वाले बैंक से पूछें।',
  share: 'इस नतीजे का लिंक कॉपी करें',
  shareCopied: 'लिंक कॉपी हो गया',
  formulaTitle: 'गणना कैसे होती है',
  formulaWhere:
    'r = सालाना दर ÷ 12 ÷ 100, n = महीने। कोष्ठक वह EMI है जो आप और ले सकते हैं; लोन वह राशि है जिसकी EMI इसके बराबर हो।',
  assumptionsTitle: 'मान्यताएँ',
  assumptions: [
    'FOIR सीमा हर बैंक और आय के हिसाब से अलग होती है (अक्सर हाथ में आने वाली आय का 40% से 60%)। बैंक से उसकी सीमा पूछें।',
    'बैंक लोन को प्रॉपर्टी की कीमत के एक हिस्से तक भी सीमित रखते हैं, और क्रेडिट स्कोर, उम्र और नौकरी भी देखते हैं। बैंक का ऑफ़र कम हो सकता है।',
    'अपना पैसा = प्रॉपर्टी की कीमत − सबसे बड़ा लोन। स्टांप ड्यूटी, रजिस्ट्रेशन और फ़ीस अलग से।',
    'पूरे लोन में ब्याज दर एक जैसी रहती है।',
  ],
  backHome: 'सभी टूल',
};

export const eligibilityStrings = { en, hi } as const;
