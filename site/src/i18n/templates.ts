/**
 * Strings for the template "coming soon" pages (/templates/<id>/). `hi` is typed as
 * `TemplateStrings`, so a missing or extra key fails typecheck; site/test/templates.test.ts also
 * checks key parity and rejects empty values.
 * Owner decision 2026-10-05: templates show as "coming soon" with NO price.
 * Hindi copy is a draft and must be reviewed by a fluent speaker before launch (PROGRESS Q10).
 */
import commissionLedgerSpec from '../../../products/commission-ledger/spec.json' with { type: 'json' };
import leadTrackerSpec from '../../../products/lead-tracker/spec.json' with { type: 'json' };
import type { TemplateId, TemplateSpec } from '../lib/templates.js';

const en = {
  backHome: 'All tools',
  badge: 'Coming soon',
  insideTitle: 'What’s inside',
  sheetLabel: 'Sheet',
  columnsLabel: 'Columns',
  autoMark: 'auto',
  autoLegend: 'Columns marked “auto” are grey in the sheet and fill themselves from a formula.',
  noColumns: 'Nothing to type here — it fills itself.',
  worksIn: 'Works in Google Sheets and Excel.',
  priceTitle: 'Price',
  noPrice: 'There is no price yet. Nothing is on sale and we will not ask you to pay anything now.',
  notifyLead: 'Want to know when it is ready? Leave your email on the home page.',
  notifyMe: 'Notify me',
  pages: {
    'lead-tracker': {
      metaTitle: 'Lead & site-visit tracker for Google Sheets (coming soon)',
      metaDescription:
        'A ready-made Google Sheets lead tracker for Indian real-estate agents: every enquiry, follow-up date and site visit, with a daily “call today” list. Coming soon.',
      h1: 'Lead & site-visit tracker',
      lead: 'One sheet for every enquiry — budget, location, status and the next follow-up date. The “Call today” sheet lists everyone you need to call, oldest first, so no lead is forgotten. Site visits and a simple summary by status and source are included.',
      extraNote: '',
    },
    'commission-ledger': {
      metaTitle: 'Commission ledger for Google Sheets (coming soon)',
      metaDescription:
        'A ready-made Google Sheets commission ledger for Indian real-estate agents: commission per deal, what is received and pending, and co-broker splits. Coming soon.',
      h1: 'Commission ledger',
      lead: 'Write each deal once and log every payment you receive. The ledger works out the commission, the total to bill, what is still pending and how much goes to a co-broker — so you always know who owes you what.',
      extraNote:
        'GST % is entered by you for each deal — no tax rate is built in. TDS is not included. This sheet only does the arithmetic; it is not tax advice. Ask your CA what applies to you.',
    },
  } satisfies Record<TemplateId, Record<string, string>>,
};

export type TemplateStrings = typeof en;

const hi: TemplateStrings = {
  backHome: 'सभी टूल',
  badge: 'जल्द आ रहा है',
  insideTitle: 'इसमें क्या है',
  sheetLabel: 'शीट',
  columnsLabel: 'कॉलम',
  autoMark: 'अपने-आप',
  autoLegend: '“अपने-आप” वाले कॉलम शीट में ग्रे हैं और फ़ॉर्मूले से खुद भर जाते हैं।',
  noColumns: 'यहाँ कुछ लिखना नहीं है — यह अपने-आप भरती है।',
  worksIn: 'Google Sheets और Excel दोनों में चलता है।',
  priceTitle: 'कीमत',
  noPrice: 'अभी कोई कीमत तय नहीं है। अभी कुछ बिक नहीं रहा और हम आपसे कोई भुगतान नहीं माँगेंगे।',
  notifyLead: 'तैयार होने पर जानना चाहते हैं? होम पेज पर अपना ईमेल छोड़ें।',
  notifyMe: 'मुझे बताएँ',
  pages: {
    'lead-tracker': {
      metaTitle: 'Google Sheets के लिए लीड और साइट-विज़िट ट्रैकर (जल्द आ रहा है)',
      metaDescription:
        'भारतीय रियल-एस्टेट एजेंटों के लिए तैयार Google Sheets लीड ट्रैकर: हर पूछताछ, फ़ॉलो-अप की तारीख और साइट विज़िट, साथ में रोज़ की “आज कॉल करें” सूची। जल्द आ रहा है।',
      h1: 'लीड और साइट-विज़िट ट्रैकर',
      lead: 'हर पूछताछ के लिए एक पंक्ति — बजट, लोकेशन, स्थिति और अगले फ़ॉलो-अप की तारीख। “आज कॉल करें” शीट में वे सब लोग दिखते हैं जिन्हें आज कॉल करना है, सबसे पुराने पहले, ताकि कोई लीड छूटे नहीं। साथ में साइट विज़िट और स्थिति व स्रोत के हिसाब से आसान सारांश भी है।',
      extraNote: '',
    },
    'commission-ledger': {
      metaTitle: 'Google Sheets के लिए कमीशन लेजर (जल्द आ रहा है)',
      metaDescription:
        'भारतीय रियल-एस्टेट एजेंटों के लिए तैयार Google Sheets कमीशन लेजर: हर डील का कमीशन, कितना मिला और कितना बाकी, और को-ब्रोकर का हिस्सा। जल्द आ रहा है।',
      h1: 'कमीशन लेजर',
      lead: 'हर डील एक बार लिखें और जो भी रकम मिले उसे दर्ज करें। लेजर कमीशन, कुल बिल, कितना बाकी है और को-ब्रोकर को कितना जाएगा — यह सब खुद निकाल देता है, ताकि आपको हमेशा पता रहे कि किससे कितना लेना है।',
      extraNote:
        'GST % हर डील के लिए आप खुद डालते हैं — कोई टैक्स दर पहले से नहीं भरी है। TDS इसमें शामिल नहीं है। यह शीट सिर्फ़ हिसाब करती है, यह टैक्स सलाह नहीं है। आप पर क्या लागू होता है, यह अपने CA से पूछें।',
    },
  },
};

export const templateStrings = { en, hi } as const;

export const templateSpecs: Record<TemplateId, TemplateSpec> = {
  'lead-tracker': leadTrackerSpec,
  'commission-ledger': commissionLedgerSpec,
};
