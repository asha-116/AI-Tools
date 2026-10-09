/** Rental yield calculator strings. `hi` must have exactly the keys of `en`. */
const en = {
  metaTitle: 'Rental yield calculator: gross and net yield on a flat',
  metaDescription:
    'Enter the property value, monthly rent, empty months and yearly costs to see the gross and net rental yield and the yearly income. Runs on your phone.',
  h1: 'Rental yield calculator',
  lead: 'How much does a property earn in rent each year, as a share of what it costs? Everything is calculated on this device.',
  propertyLegend: 'The property',
  valueLabel: 'Property value (₹)',
  purchaseLabel: 'Stamp duty, registration, interiors (₹, optional)',
  rentLegend: 'Rent and costs',
  rentLabel: 'Rent per month (₹)',
  vacancyLabel: 'Months empty each year (optional)',
  costsLabel: 'Costs the owner pays each year (₹, optional)',
  errorValue: 'Enter a property value above ₹0.',
  errorPurchase: 'Enter 0 or a positive amount.',
  errorRent: 'Enter a monthly rent above ₹0.',
  errorVacancy: 'Enter a number of months from 0 to 12.',
  errorCosts: 'Enter 0 or a positive amount.',
  resultNet: 'Net rental yield',
  resultGross: 'Gross rental yield',
  rowInvestment: 'Money put in',
  rowAnnualRent: 'Rent for 12 months',
  rowCollected: 'Rent actually collected',
  rowNetIncome: 'Net income a year',
  rowYears: 'Years of rent to equal the money put in',
  share: 'Copy link to this result',
  shareCopied: 'Link copied',
  formulaTitle: 'How it is calculated',
  formulaWhere:
    'Gross yield = rent for 12 months ÷ money put in × 100. Net yield takes off the empty months and the yearly costs.',
  assumptionsTitle: 'Assumptions',
  assumptions: [
    'Yearly costs are what the owner pays: society maintenance, property tax, insurance, repairs and brokerage for new tenants.',
    'Before income tax and before any home-loan interest. For tax, ask a CA.',
    'Rent stays the same all year; rent increases and a change in the property’s value are not included.',
    'This shows numbers only. It is not advice on whether to buy, sell or rent out.',
  ],
  backHome: 'All tools',
};

export type YieldStrings = typeof en;

const hi: YieldStrings = {
  metaTitle: 'रेंटल यील्ड कैलकुलेटर: फ़्लैट पर ग्रॉस और नेट यील्ड',
  metaDescription:
    'प्रॉपर्टी की कीमत, मासिक किराया, खाली महीने और सालाना खर्च डालें और ग्रॉस व नेट रेंटल यील्ड और सालाना आय देखें। आपके फ़ोन पर चलता है।',
  h1: 'रेंटल यील्ड कैलकुलेटर',
  lead: 'प्रॉपर्टी अपनी लागत के हिस्से के रूप में हर साल कितना किराया कमाती है? सारी गणना इसी डिवाइस पर होती है।',
  propertyLegend: 'प्रॉपर्टी',
  valueLabel: 'प्रॉपर्टी की कीमत (₹)',
  purchaseLabel: 'स्टांप ड्यूटी, रजिस्ट्रेशन, इंटीरियर (₹, वैकल्पिक)',
  rentLegend: 'किराया और खर्च',
  rentLabel: 'हर महीने का किराया (₹)',
  vacancyLabel: 'साल में कितने महीने खाली (वैकल्पिक)',
  costsLabel: 'मालिक के सालाना खर्च (₹, वैकल्पिक)',
  errorValue: '₹0 से ज़्यादा प्रॉपर्टी की कीमत डालें।',
  errorPurchase: '0 या कोई धनात्मक राशि डालें।',
  errorRent: '₹0 से ज़्यादा मासिक किराया डालें।',
  errorVacancy: '0 से 12 के बीच महीने डालें।',
  errorCosts: '0 या कोई धनात्मक राशि डालें।',
  resultNet: 'नेट रेंटल यील्ड',
  resultGross: 'ग्रॉस रेंटल यील्ड',
  rowInvestment: 'लगाया गया पैसा',
  rowAnnualRent: '12 महीने का किराया',
  rowCollected: 'असल में मिला किराया',
  rowNetIncome: 'सालाना नेट आय',
  rowYears: 'लगाए गए पैसे जितना किराया आने में साल',
  share: 'इस नतीजे का लिंक कॉपी करें',
  shareCopied: 'लिंक कॉपी हो गया',
  formulaTitle: 'गणना कैसे होती है',
  formulaWhere:
    'ग्रॉस यील्ड = 12 महीने का किराया ÷ लगाया गया पैसा × 100। नेट यील्ड में खाली महीने और सालाना खर्च घटाए जाते हैं।',
  assumptionsTitle: 'मान्यताएँ',
  assumptions: [
    'सालाना खर्च वे हैं जो मालिक देता है: सोसाइटी मेंटेनेंस, प्रॉपर्टी टैक्स, बीमा, मरम्मत और नए किरायेदार की ब्रोकरेज।',
    'इनकम टैक्स और होम लोन के ब्याज से पहले। टैक्स के लिए CA से पूछें।',
    'पूरे साल किराया एक जैसा रहता है; किराया बढ़ना और प्रॉपर्टी की कीमत बदलना शामिल नहीं।',
    'यह सिर्फ़ आँकड़े दिखाता है। खरीदने, बेचने या किराये पर देने की सलाह नहीं है।',
  ],
  backHome: 'सभी टूल',
};

export const yieldStrings = { en, hi } as const;
