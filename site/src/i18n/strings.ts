/**
 * All user-facing strings. `hi` is typed as `Strings`, so a missing or extra key fails
 * typecheck; site/test/strings.test.ts also rejects empty values.
 * Hindi copy is a draft and must be reviewed by a fluent speaker before launch (PROGRESS Q10).
 */
const en = {
  metaTitle: 'Simple tools for real-estate agents in India',
  metaDescription:
    'Free calculators and low-cost templates for Indian real-estate agents — stamp duty, lead tracking, commissions. Tell us which one to build first.',
  langSwitchLabel: 'हिन्दी में पढ़ें',
  heroTitle: 'Simple tools for real-estate agents',
  heroLead:
    'Calculators and ready-made sheets that save you time on every deal — in English and Hindi. We are choosing what to build first. Tell us what you need.',
  heroCta: 'Vote with your email',
  ideasTitle: 'Which one should we build first?',
  kindFree: 'Free tool',
  kindPaid: 'Template · coming soon',
  notifyMe: 'Notify me',
  seeInside: 'See what’s inside',
  formTitle: 'Get notified when it is ready',
  formEmailLabel: 'Your email',
  formIdeaLegend: 'I want',
  formConsent:
    'Email me once when this tool is ready. I can ask for my email to be deleted at any time.',
  formSubmit: 'Notify me',
  formSending: 'Sending…',
  formSuccess: 'Thank you! We will email you when it is ready.',
  formErrorGeneric: 'Something went wrong. Please try again in a minute.',
  formErrorEmail: 'Please enter a valid email address.',
  formErrorConsent: 'Please tick the box so we can email you.',
  formErrorRate: 'Too many attempts. Please try again in an hour.',
  formClosed: 'The waitlist opens soon. Please check back in a few days.',
  formNoScript: 'Please enable JavaScript to join the waitlist.',
  privacyTitle: 'Your data',
  privacyBody:
    'We store only your email address, the tool you chose and your language, on Cloudflare servers. We use it only to tell you about that tool. We never sell or share it.',
  privacyContact: 'To have your email deleted, write to',
  disclaimer:
    'Our calculators are for estimation only — verify with a professional. Nothing on this site is legal, tax or financial advice.',
  footerNote: 'Made in India for Indian real-estate agents.',
  toolDisclaimer: 'For estimation only — verify with a professional.',
  toolsTitle: 'Free tools you can use today',
  emiCardTitle: 'EMI calculator',
  emiCardSummary: 'Monthly instalment, total interest and total payment for any loan.',
  commissionCardTitle: 'Commission split calculator',
  commissionCardSummary: 'Brokerage, GST and each co-broker’s share — to the paisa.',
  areaCardTitle: 'Land area converter',
  areaCardSummary: 'Acres, gaj, sq ft, sq m and hectares — one area in every unit.',
  prepaymentCardTitle: 'Home loan prepayment calculator',
  prepaymentCardSummary: 'How much interest and how many years a prepayment saves.',
  eligibilityCardTitle: 'Home loan eligibility calculator',
  eligibilityCardSummary: 'The largest loan and EMI a buyer can get on their income.',
  openTool: 'Open',
};

export type Strings = typeof en;

const hi: Strings = {
  metaTitle: 'भारत के रियल-एस्टेट एजेंटों के लिए आसान टूल',
  metaDescription:
    'भारतीय रियल-एस्टेट एजेंटों के लिए मुफ़्त कैलकुलेटर और कम कीमत वाले टेम्पलेट — स्टांप ड्यूटी, लीड ट्रैकिंग, कमीशन। बताइए पहले कौन-सा बनाएँ।',
  langSwitchLabel: 'Read in English',
  heroTitle: 'रियल-एस्टेट एजेंटों के लिए आसान टूल',
  heroLead:
    'कैलकुलेटर और तैयार शीट जो हर डील पर आपका समय बचाएँ — हिन्दी और English में। हम तय कर रहे हैं कि पहले क्या बनाएँ। बताइए आपको क्या चाहिए।',
  heroCta: 'अपने ईमेल से वोट करें',
  ideasTitle: 'पहले कौन-सा बनाएँ?',
  kindFree: 'मुफ़्त टूल',
  kindPaid: 'टेम्पलेट · जल्द आ रहा है',
  notifyMe: 'मुझे बताएँ',
  seeInside: 'अंदर क्या है देखें',
  formTitle: 'तैयार होने पर सूचना पाएँ',
  formEmailLabel: 'आपका ईमेल',
  formIdeaLegend: 'मुझे चाहिए',
  formConsent:
    'यह टूल तैयार होने पर मुझे एक बार ईमेल करें। मैं कभी भी अपना ईमेल हटाने को कह सकता/सकती हूँ।',
  formSubmit: 'मुझे बताएँ',
  formSending: 'भेजा जा रहा है…',
  formSuccess: 'धन्यवाद! तैयार होते ही हम आपको ईमेल करेंगे।',
  formErrorGeneric: 'कुछ गड़बड़ हो गई। कृपया एक मिनट बाद फिर कोशिश करें।',
  formErrorEmail: 'कृपया सही ईमेल पता डालें।',
  formErrorConsent: 'कृपया बॉक्स पर टिक करें ताकि हम आपको ईमेल कर सकें।',
  formErrorRate: 'बहुत ज़्यादा कोशिशें हुईं। कृपया एक घंटे बाद फिर कोशिश करें।',
  formClosed: 'वेटलिस्ट जल्द खुलेगी। कृपया कुछ दिनों बाद देखें।',
  formNoScript: 'वेटलिस्ट में जुड़ने के लिए कृपया JavaScript चालू करें।',
  privacyTitle: 'आपका डेटा',
  privacyBody:
    'हम केवल आपका ईमेल पता, आपका चुना हुआ टूल और आपकी भाषा Cloudflare सर्वर पर रखते हैं। इसका उपयोग केवल उसी टूल के बारे में बताने के लिए होता है। हम इसे कभी बेचते या साझा नहीं करते।',
  privacyContact: 'अपना ईमेल हटवाने के लिए लिखें:',
  disclaimer:
    'हमारे कैलकुलेटर केवल अनुमान के लिए हैं — किसी विशेषज्ञ से पुष्टि करें। इस साइट पर कुछ भी कानूनी, कर या वित्तीय सलाह नहीं है।',
  footerNote: 'भारत में, भारतीय रियल-एस्टेट एजेंटों के लिए बनाया गया।',
  toolDisclaimer: 'केवल अनुमान के लिए — किसी विशेषज्ञ से पुष्टि करें।',
  toolsTitle: 'मुफ़्त टूल जो आज ही इस्तेमाल करें',
  emiCardTitle: 'EMI कैलकुलेटर',
  emiCardSummary: 'किसी भी लोन की मासिक किस्त, कुल ब्याज और कुल भुगतान।',
  commissionCardTitle: 'कमीशन बँटवारा कैलकुलेटर',
  commissionCardSummary: 'ब्रोकरेज, GST और हर को-ब्रोकर का हिस्सा — पैसे तक सटीक।',
  areaCardTitle: 'ज़मीन का क्षेत्रफल कन्वर्टर',
  areaCardSummary: 'एकड़, गज़, वर्ग फ़ुट, वर्ग मीटर और हेक्टेयर — एक क्षेत्रफल हर इकाई में।',
  prepaymentCardTitle: 'होम लोन प्रीपेमेंट कैलकुलेटर',
  prepaymentCardSummary: 'प्रीपेमेंट से कितना ब्याज और कितने साल बचते हैं।',
  eligibilityCardTitle: 'होम लोन पात्रता कैलकुलेटर',
  eligibilityCardSummary: 'खरीदार को उसकी आय पर मिलने वाला सबसे बड़ा लोन और EMI।',
  openTool: 'खोलें',
};

export const strings = { en, hi } as const;
export type Lang = keyof typeof strings;
export const LANGS: readonly Lang[] = ['en', 'hi'];
