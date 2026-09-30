/** Stamp duty calculator strings. `hi` must have exactly the keys of `en`. */
const en = {
  metaTitle: 'Stamp duty & registration cost calculator',
  metaDescription:
    'Estimate stamp duty, surcharges and registration fee for a property purchase, state by state, with the source for every rate. Runs on your phone.',
  h1: 'Stamp duty & registration calculator',
  lead: 'Estimate what your buyer pays the government to register the property. Every rate shows its source and when it was last checked.',
  comingSoon:
    'We are verifying each state’s rates against official government sources before publishing them. Check back soon — or join the waitlist on the home page to be told when it is live.',
  draftBanner:
    'DRAFT RATES — NOT VERIFIED. For owner review only. Do not use these numbers for a real transaction.',
  draftSuffix: ' (draft)',
  stateLabel: 'State',
  areaLabel: 'Area',
  buyerLegend: 'Buyer',
  buyerMale: 'Man',
  buyerFemale: 'Woman',
  buyerJoint: 'Joint (man + woman)',
  valueLabel: 'Property value (₹)',
  valueHint:
    'Use the higher of the agreement value and the government (circle / ready reckoner / guideline) value.',
  errorValue: 'Enter a property value above ₹0.',
  resultStampDuty: 'Stamp duty',
  resultRegistration: 'Registration fee',
  resultTotal: 'Total to government',
  resultRule: 'Rate applied: {rule}',
  lastVerified: 'Rates last checked: {date}',
  sourcesTitle: 'Sources',
  officialSource: 'Official site to verify',
  conflictsTitle: 'Open questions in the sources',
  share: 'Copy link to this result',
  shareCopied: 'Link copied',
  formulaTitle: 'How it is calculated',
  formula: [
    'Stamp duty = property value × state rate %',
    'Surcharges (cess, metro cess, local body tax) = property value × % (or stamp duty × %, where the state charges it on the duty)',
    'Registration fee = property value × % (with the state’s cap or minimum), plus any fixed fee',
  ],
  assumptionsTitle: 'Assumptions',
  assumptions: [
    'Residential property sale deed.',
    'Rates change often and depend on area, buyer and value — always check the official site before paying.',
    'Legal fees, society charges, GST on under-construction property and TDS are not included.',
    'Amounts are rounded to the nearest rupee for display.',
  ],
  backHome: 'All tools',
};

export type SdStrings = typeof en;

const hi: SdStrings = {
  metaTitle: 'स्टांप ड्यूटी और रजिस्ट्रेशन खर्च कैलकुलेटर',
  metaDescription:
    'प्रॉपर्टी खरीद पर स्टांप ड्यूटी, सरचार्ज और रजिस्ट्रेशन फीस का अनुमान — राज्य के अनुसार, हर दर के स्रोत के साथ। आपके फ़ोन पर चलता है।',
  h1: 'स्टांप ड्यूटी और रजिस्ट्रेशन कैलकुलेटर',
  lead: 'अनुमान लगाएँ कि प्रॉपर्टी रजिस्टर करवाने के लिए आपका खरीदार सरकार को कितना देगा। हर दर का स्रोत और आख़िरी जाँच की तारीख़ दिखती है।',
  comingSoon:
    'हम हर राज्य की दरें आधिकारिक सरकारी स्रोतों से मिलाकर ही प्रकाशित करते हैं। जल्द ही फिर देखें — या तैयार होने पर सूचना पाने के लिए होम पेज पर वेटलिस्ट से जुड़ें।',
  draftBanner:
    'ड्राफ़्ट दरें — जाँची नहीं गईं। केवल मालिक की समीक्षा के लिए। किसी असली सौदे के लिए इन आँकड़ों का उपयोग न करें।',
  draftSuffix: ' (ड्राफ़्ट)',
  stateLabel: 'राज्य',
  areaLabel: 'क्षेत्र',
  buyerLegend: 'खरीदार',
  buyerMale: 'पुरुष',
  buyerFemale: 'महिला',
  buyerJoint: 'संयुक्त (पुरुष + महिला)',
  valueLabel: 'प्रॉपर्टी की कीमत (₹)',
  valueHint:
    'सौदे की कीमत और सरकारी (सर्कल / रेडी रेकनर / गाइडलाइन) कीमत में से जो ज़्यादा हो, वह डालें।',
  errorValue: '₹0 से ज़्यादा प्रॉपर्टी की कीमत डालें।',
  resultStampDuty: 'स्टांप ड्यूटी',
  resultRegistration: 'रजिस्ट्रेशन फीस',
  resultTotal: 'सरकार को कुल भुगतान',
  resultRule: 'लागू दर: {rule}',
  lastVerified: 'दरें आख़िरी बार जाँची गईं: {date}',
  sourcesTitle: 'स्रोत',
  officialSource: 'जाँच के लिए आधिकारिक साइट',
  conflictsTitle: 'स्रोतों में अनसुलझे सवाल',
  share: 'इस नतीजे का लिंक कॉपी करें',
  shareCopied: 'लिंक कॉपी हो गया',
  formulaTitle: 'गणना कैसे होती है',
  formula: [
    'स्टांप ड्यूटी = प्रॉपर्टी की कीमत × राज्य की दर %',
    'सरचार्ज (सेस, मेट्रो सेस, स्थानीय निकाय कर) = प्रॉपर्टी की कीमत × % (या स्टांप ड्यूटी × %, जहाँ राज्य ड्यूटी पर लगाता है)',
    'रजिस्ट्रेशन फीस = प्रॉपर्टी की कीमत × % (राज्य की अधिकतम / न्यूनतम सीमा के साथ), साथ में कोई तय फीस',
  ],
  assumptionsTitle: 'मान्यताएँ',
  assumptions: [
    'आवासीय प्रॉपर्टी का बिक्री विलेख (सेल डीड)।',
    'दरें अक्सर बदलती हैं और क्षेत्र, खरीदार व कीमत पर निर्भर करती हैं — भुगतान से पहले हमेशा आधिकारिक साइट देखें।',
    'वकील की फीस, सोसायटी शुल्क, निर्माणाधीन प्रॉपर्टी पर GST और TDS शामिल नहीं हैं।',
    'दिखाने के लिए राशि को नज़दीकी रुपये तक राउंड किया गया है।',
  ],
  backHome: 'सभी टूल',
};

export const sdStrings = { en, hi } as const;
