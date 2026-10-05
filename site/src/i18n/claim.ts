/** "Get my download" page strings. `hi` must have exactly the keys of `en`. */
const en = {
  metaTitle: 'Get your download',
  metaDescription: 'Download the template you bought, using your Razorpay payment ID and email.',
  h1: 'Get your download',
  lead: 'Bought a template? Enter the payment ID from your Razorpay receipt email and the email address you paid with.',
  paymentIdLabel: 'Payment ID',
  paymentIdHint: 'Starts with “pay_”, e.g. pay_ABC123xyz. It is in the Razorpay receipt email.',
  emailLabel: 'Email used for payment',
  submit: 'Get download links',
  sending: 'Checking…',
  linksTitle: 'Your downloads',
  linksNote:
    'These links work until {date}. You can come back to this page any time for fresh links.',
  errorPaymentId: 'Enter the payment ID exactly as shown on your receipt (it starts with “pay_”).',
  errorEmail: 'Enter the email address you used to pay.',
  errorNotFound:
    'We could not find that payment with that email. Check both, and wait a minute if you paid just now.',
  errorNeedsSupport:
    'We received your payment but could not match it to a product. Please email us with your payment ID and we will send your file.',
  errorRate: 'Too many attempts. Please try again in an hour.',
  errorGeneric: 'Something went wrong. Please try again in a minute.',
  notConfigured: 'Downloads are not open yet. Paid templates are coming soon.',
  supportLine: 'Need help? Email {email} with your payment ID.',
  backHome: 'All tools',
};

export type ClaimStrings = typeof en;

const hi: ClaimStrings = {
  metaTitle: 'अपना डाउनलोड पाएँ',
  metaDescription: 'अपने Razorpay पेमेंट ID और ईमेल से खरीदा हुआ टेम्पलेट डाउनलोड करें।',
  h1: 'अपना डाउनलोड पाएँ',
  lead: 'टेम्पलेट खरीदा है? Razorpay की रसीद वाले ईमेल से पेमेंट ID और वह ईमेल डालें जिससे आपने भुगतान किया।',
  paymentIdLabel: 'पेमेंट ID',
  paymentIdHint:
    '“pay_” से शुरू होता है, जैसे pay_ABC123xyz. यह Razorpay की रसीद वाले ईमेल में है।',
  emailLabel: 'भुगतान वाला ईमेल',
  submit: 'डाउनलोड लिंक पाएँ',
  sending: 'जाँच हो रही है…',
  linksTitle: 'आपके डाउनलोड',
  linksNote: 'ये लिंक {date} तक काम करेंगे। नए लिंक के लिए आप कभी भी इस पेज पर लौट सकते हैं।',
  errorPaymentId: 'रसीद पर लिखा पेमेंट ID वैसा ही डालें (यह “pay_” से शुरू होता है)।',
  errorEmail: 'वह ईमेल डालें जिससे आपने भुगतान किया।',
  errorNotFound:
    'इस ईमेल के साथ यह पेमेंट नहीं मिला। दोनों जाँचें, और अगर अभी भुगतान किया है तो एक मिनट रुकें।',
  errorNeedsSupport:
    'आपका भुगतान मिल गया, पर इसे किसी प्रोडक्ट से नहीं मिला पाए। कृपया पेमेंट ID के साथ हमें ईमेल करें, हम फ़ाइल भेज देंगे।',
  errorRate: 'बहुत ज़्यादा कोशिशें। कृपया एक घंटे बाद फिर कोशिश करें।',
  errorGeneric: 'कुछ गड़बड़ हो गई। कृपया एक मिनट बाद फिर कोशिश करें।',
  notConfigured: 'डाउनलोड अभी शुरू नहीं हुए हैं। पेड टेम्पलेट जल्द आ रहे हैं।',
  supportLine: 'मदद चाहिए? पेमेंट ID के साथ {email} पर ईमेल करें।',
  backHome: 'सभी टूल',
};

export const claimStrings = { en, hi } as const;
