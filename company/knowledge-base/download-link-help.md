# Download link help

<!-- support-template
id: download-link-help
category: download_issue
status: draft
-->

Used by the Support agent for `download_issue`. Delivery works as in ADR-023: the buyer gets
fresh links on `/get-download/` with payment ID + email; links last 72 hours. Placeholder:
`{payment_id}` (filled locally after redaction, never sent to an LLM). Status `draft` means the
agent never sends it live until the owner changes it to `approved` (Hindi reviewed by a human).

## en

Hello,

Thank you for writing to us. You can get your download links again at any time on this page:

https://tools.changelense.in/get-download/

Enter:

1. Payment ID: {payment_id}
2. The same email address you used when you paid.

The links on that page work for 72 hours. After that, open the page again and you will get fresh
links. You never lose access to what you bought.

If the page says it cannot find your order, check that the email is exactly the one you paid with
(your Razorpay receipt shows it).

If it still does not work, reply to this email with only your payment ID and we will fix it.
Please never send card, UPI PIN or bank details. We never need them.

— ChangeLens support

## hi

नमस्ते,

हमें लिखने के लिए धन्यवाद। आप अपने डाउनलोड लिंक इस पेज पर कभी भी दोबारा पा सकते हैं:

https://tools.changelense.in/hi/get-download/

यह डालें:

1. पेमेंट ID: {payment_id}
2. वही ईमेल जिससे आपने पेमेंट किया था।

उस पेज के लिंक 72 घंटे तक चलते हैं। उसके बाद पेज फिर से खोलें, आपको नए लिंक मिल जाएँगे। आपकी
ख़रीदी हुई फ़ाइल हमेशा आपकी रहती है।

अगर पेज कहे कि आपका ऑर्डर नहीं मिला, तो देखें कि ईमेल ठीक वही है जिससे पेमेंट हुआ था (Razorpay
की रसीद पर लिखा होता है)।

अगर फिर भी काम न करे, तो इस ईमेल के जवाब में सिर्फ़ अपनी पेमेंट ID भेजें, हम ठीक कर देंगे। कार्ड,
UPI PIN या बैंक की जानकारी कभी न भेजें। हमें इनकी कभी ज़रूरत नहीं होती।

— ChangeLens सपोर्ट
