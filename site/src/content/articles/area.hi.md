---
title: 'ज़मीन का क्षेत्रफल कन्वर्टर - Land Area Converter'
description: 'वर्ग फ़ुट, गज़, एकड़, हेक्टेयर और वर्ग मीटर में ज़मीन का क्षेत्रफल आसानी से बदलें।'
slug: 'area'
lang: hi
tool_path: '/hi/tools/area/'
last_verified: '2026-10-09'
generated: '2026-10-11'
generated_by: 'agent:seo-listing'
producer_family: 'gemini'
status: 'draft'
---

# ज़मीन का क्षेत्रफल कन्वर्टर - Land Area Converter

प्रॉपर्टी एजेंट्स और खरीदारों को अक्सर अलग-अलग इकाइयों जैसे वर्ग फ़ुट, गज़, एकड़, हेक्टेयर और वर्ग मीटर में ज़मीन का क्षेत्रफल समझना पड़ता है। ग्राहक अक्सर स्थानीय भाषा में ज़मीन का माप बताते हैं, जबकि कागज़ात में दूसरी इकाई होती है। यह मुफ़्त टूल आपको अपने मोबाइल पर किसी भी इकाई को सभी प्रमुख माप इकाइयों में तुरंत बदलने की सुविधा देता है। इससे साइट विजिट के दौरान बातचीत आसान होती है।

## कैलकुलेटर कैसे इस्तेमाल करें

1. ड्रॉपडाउन मेनू से अपनी मूल माप इकाई चुनें।
2. इनपुट फ़ील्ड में ज़मीन का क्षेत्रफल दर्ज करें।
3. नीचे दी गई तालिका में सभी इकाइयों में बदला हुआ माप तुरंत देखें।
4. उदाहरण के लिए, 1 एकड़ डालने पर आपको 43,560 वर्ग फ़ुट, 4,840 गज़, 4,046.8564 वर्ग मीटर, और 0.4047 हेक्टेयर दिखेगा।

[कैलकुलेटर खोलें: ज़मीन का क्षेत्रफल कन्वर्टर](/hi/tools/area/)

## उदाहरण से समझें

| इनपुट     |    मान |
| --------- | -----: |
| क्षेत्रफल | 1 एकड़ |

| नतीजा     |                  मान |
| --------- | -------------------: |
| वर्ग फ़ुट |     43,560 वर्ग फ़ुट |
| गज़       |            4,840 गज़ |
| वर्ग मीटर | 4,046.8564 वर्ग मीटर |
| हेक्टेयर  |      0.4047 हेक्टेयर |

_इकाइयों के माप data/land-units/standard.json से (सटीक परिभाषाएँ); नतीजे कन्वर्टर के अपने कोड से।_

## गणना कैसे होती है

- value in target unit = value × (size of source unit in m²) ÷ (size of target unit in m²)
- हर इकाई का वर्ग मीटर में एक तय आकार है; क्षेत्रफल वर्ग मीटर के ज़रिए बदला जाता है।

यह टूल सबसे पहले हर इकाई को वर्ग मीटर में बदलता है। आपकी लक्षित इकाई का मान निकालने के लिए, शुरुआती मान को वर्ग मीटर में उसकी इकाई के आकार से गुणा किया जाता है और लक्षित इकाई के आकार से भाग दिया जाता है। 1 गज़ 9 वर्ग फ़ुट के बराबर होता है। 1 एकड़ 43,560 वर्ग फ़ुट के बराबर होता है। वर्ग मीटर को मानक आधार मानने से सभी इकाइयों का रूपांतरण सटीक रहता है।

### मान्यताएँ

- 1 फ़ुट = ठीक 0.3048 मीटर और 1 गज़ = ठीक 0.9144 मीटर, इसलिए 1 वर्ग गज़ = 9 वर्ग फ़ुट।
- 1 एकड़ = 4,840 वर्ग गज़ = 43,560 वर्ग फ़ुट; 1 हेक्टेयर = 10,000 वर्ग मीटर।
- नतीजे दिखाने के लिए 4 दशमलव स्थानों तक पूर्णांकित हैं।
- क्षेत्रफल के लिए भूमि रिकॉर्ड और बिक्री विलेख ही अंतिम हैं; स्थानीय इकाइयाँ अलग हो सकती हैं।

## यह कब काम आता है

साइट विजिट, ग्राहक बैठकों और प्रॉपर्टी लिस्टिंग तैयार करते समय इस टूल का उपयोग करें। यह ग्रामीण या कृषि भूमि को एकड़ से वर्ग फ़ुट में बदलकर शहर के खरीदारों को समझाने में मदद करता है। हालांकि, यह टूल मानक गणितीय गणना पर काम करता है और बीघा या गुंठा जैसे स्थानीय अंतरों को शामिल नहीं करता। रजिस्ट्री, कानूनी दस्तावेज़ों या सीमा विवादों के लिए हमेशा ज़मीन के रिकॉर्ड देखें या वकील से सलाह लें।

## अक्सर पूछे जाने वाले सवाल

### क्या अलग-अलग राज्यों में ज़मीन के माप अलग होते हैं?

हां, भारत के अलग-अलग राज्यों में स्थानीय इकाइयों के माप में अंतर हो सकता है। सटीक कानूनी माप के लिए ज़मीन के कागज़ात देखें या वकील से सलाह लें।

### क्या 1 एकड़ को तुरंत वर्ग फ़ुट या गज़ में बदला जा सकता है?

हां, टूल में 1 एकड़ दर्ज करते ही आपको 43,560 वर्ग फ़ुट या 4,840 गज़ तुरंत दिखाई देगा।

### क्या यह कैलकुलेशन रजिस्ट्री या सेल डीड के लिए इस्तेमाल की जा सकती है?

यह टूल आपके दैनिक काम को आसान बनाने के लिए त्वरित गणितीय गणना देता है। सेल डीड के लिए हमेशा रजिस्ट्री ऑफिस के दस्तावेज़ या वकील से पुष्टि करें।

## और टूल

- [EMI कैलकुलेटर](/hi/tools/emi/)
- [कमीशन बँटवारा कैलकुलेटर](/hi/tools/commission/)
- [स्टांप ड्यूटी और रजिस्ट्रेशन कैलकुलेटर](/hi/tools/stamp-duty/)
- [होम लोन प्रीपेमेंट कैलकुलेटर](/hi/tools/prepayment/)
- [होम लोन पात्रता कैलकुलेटर](/hi/tools/eligibility/)
- [कारपेट एरिया और प्रति वर्ग फ़ुट असली कीमत](/hi/tools/carpet-area/)
- [रेंटल यील्ड कैलकुलेटर](/hi/tools/rental-yield/)
- [किराया या खरीदें कैलकुलेटर](/hi/tools/rent-vs-buy/)
- [होम लोन बैलेंस ट्रांसफ़र कैलकुलेटर](/hi/tools/balance-transfer/)
- [सभी टूल](/hi/)

## स्रोत

- <https://en.wikipedia.org/wiki/International_yard_and_pound>
- <https://www.nist.gov/node/1582061>
- <https://proofwiki.org/wiki/Definition:Acre/Conversion_Factors>
- <https://1acre.in/land-unit-converter/guntha-to-sqft>
- <https://www.bajajfinserv.in/guntha-to-square-feet>
- <https://www.tatacapital.com/calculator/guntha-to-square-feet.html>
- <https://1acre.in/land-unit-converter/acre-to-guntha>
- <https://1acre.in/land-unit-converter/cent-to-sqft>
- <https://www.tatacapital.com/calculator/cent-to-ground.html>
- <https://housing.com/calculators/ground-to-square-feet>
- <https://www.tatacapital.com/calculator/ground-to-square-feet.html>
- <https://community.verified.realestate/article/land-measurement-units-in-tamil-nadu-ground-cent-acre-hectare-kuzhi-ma-veli-and-official-record-conversions-explained/>
- <https://www.bajajfinserv.in/marla-to-square-feet>
- <https://1acre.in/land-unit-converter/punjab>
- <https://indialandconverter.in/punjab/ludhiana/convert-kanal-to-marla>
- <https://1acre.in/land-unit-converter/haryana>
- <https://en.wikipedia.org/wiki/Hectare>
- <https://1acre.in/land-unit-converter/maharashtra>
- <https://bhulekh.mahabhumi.gov.in>
- <https://en.wikipedia.org/wiki/Katha_(unit)>
- <https://indialandconverter.in/west-bengal/howrah/convert-katha-to-chatak>
- <https://indialandconverter.in/west-bengal/north-24-parganas/convert-chatak-to-sqft>

> केवल अनुमान के लिए — किसी विशेषज्ञ से पुष्टि करें। दरें और नियम राज्य के अनुसार अलग होते हैं और समय के साथ बदलते हैं; अंतिम बार 2026-10-09 को जाँचा गया। यह कानूनी, कर या वित्तीय सलाह नहीं है।
