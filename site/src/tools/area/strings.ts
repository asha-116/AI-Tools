/** Area converter strings. `hi` must have exactly the keys of `en`. */
const en = {
  metaTitle: 'Land area converter: acre, gaj, sq ft, hectare',
  metaDescription:
    'Convert plot and land area between acres, gaj (square yards), square feet, square metres and hectares. Runs on your phone.',
  h1: 'Land area converter',
  lead: 'Type an area once and see it in every unit. Everything is calculated on this device.',
  valueLabel: 'Area',
  unitLabel: 'Unit',
  errorValue: 'Enter an area of 0 or more.',
  resultsTitle: 'Same area in',
  draftSuffix: '(being verified)',
  draftNote:
    'Owner review: regional units marked “being verified” are hidden on the live site until someone checks them against a state source.',
  comingSoon:
    'More regional units (cent, ground, marla, kanal) are coming soon, once checked against state sources. Bigha, biswa and katha change from district to district, so check them with your local revenue office.',
  share: 'Copy link to this result',
  shareCopied: 'Link copied',
  formulaTitle: 'How it is calculated',
  formulaWhere:
    'Each unit has a fixed size in square metres; the area is converted through square metres.',
  assumptionsTitle: 'Assumptions',
  assumptions: [
    '1 foot = 0.3048 metre and 1 yard (gaj) = 0.9144 metre exactly, so 1 gaj = 9 sq ft.',
    '1 acre = 4,840 gaj = 43,560 sq ft; 1 hectare = 10,000 sq m.',
    'Results are rounded to 4 decimal places for display.',
    'Land records and sale deeds are the final word on an area; local units can differ.',
  ],
  backHome: 'All tools',
};

export type AreaStrings = typeof en;

const hi: AreaStrings = {
  metaTitle: 'ज़मीन का क्षेत्रफल कन्वर्टर: एकड़, गज़, वर्ग फ़ुट, हेक्टेयर',
  metaDescription:
    'प्लॉट और ज़मीन का क्षेत्रफल एकड़, गज़ (वर्ग गज़), वर्ग फ़ुट, वर्ग मीटर और हेक्टेयर में बदलें। आपके फ़ोन पर चलता है।',
  h1: 'ज़मीन का क्षेत्रफल कन्वर्टर',
  lead: 'क्षेत्रफल एक बार डालें और हर इकाई में देखें। सारी गणना इसी डिवाइस पर होती है।',
  valueLabel: 'क्षेत्रफल',
  unitLabel: 'इकाई',
  errorValue: '0 या उससे ज़्यादा क्षेत्रफल डालें।',
  resultsTitle: 'यही क्षेत्रफल',
  draftSuffix: '(जाँच जारी)',
  draftNote:
    'मालिक की समीक्षा: “जाँच जारी” वाली क्षेत्रीय इकाइयाँ लाइव साइट पर तब तक छिपी रहती हैं जब तक कोई उन्हें राज्य के स्रोत से न जाँच ले।',
  comingSoon:
    'और क्षेत्रीय इकाइयाँ (सेंट, ग्राउंड, मरला, कनाल) राज्य के स्रोतों से जाँच के बाद जल्द आएँगी। बीघा, बिस्वा और कट्ठा ज़िले-ज़िले में बदलते हैं, इसलिए इन्हें अपने स्थानीय राजस्व कार्यालय से जाँचें।',
  share: 'इस नतीजे का लिंक कॉपी करें',
  shareCopied: 'लिंक कॉपी हो गया',
  formulaTitle: 'गणना कैसे होती है',
  formulaWhere:
    'हर इकाई का वर्ग मीटर में एक तय आकार है; क्षेत्रफल वर्ग मीटर के ज़रिए बदला जाता है।',
  assumptionsTitle: 'मान्यताएँ',
  assumptions: [
    '1 फ़ुट = ठीक 0.3048 मीटर और 1 गज़ = ठीक 0.9144 मीटर, इसलिए 1 वर्ग गज़ = 9 वर्ग फ़ुट।',
    '1 एकड़ = 4,840 वर्ग गज़ = 43,560 वर्ग फ़ुट; 1 हेक्टेयर = 10,000 वर्ग मीटर।',
    'नतीजे दिखाने के लिए 4 दशमलव स्थानों तक पूर्णांकित हैं।',
    'क्षेत्रफल के लिए भूमि रिकॉर्ड और बिक्री विलेख ही अंतिम हैं; स्थानीय इकाइयाँ अलग हो सकती हैं।',
  ],
  backHome: 'सभी टूल',
};

export const areaStrings = { en, hi } as const;
