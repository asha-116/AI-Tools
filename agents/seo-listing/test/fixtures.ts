import type { SeoDraft } from '../schema.js';

const EN_SENTENCE =
  'Agents use this page to explain the monthly payment to a buyer in plain words.';
const HI_SENTENCE = 'एजेंट इस पेज से खरीदार को मासिक भुगतान आसान शब्दों में समझाते हैं।';

export function para(sentence: string, words: number): string {
  const per = sentence.split(/\s+/).length;
  return Array.from({ length: Math.max(1, Math.round(words / per)) }, () => sentence).join(' ');
}

/** A draft that passes every rule; `words` per prose section. */
export function goodDraft(words = 110): SeoDraft {
  const en = (lead: string) => `${lead} ${para(EN_SENTENCE, words)}`;
  const hi = (lead: string) => `${lead} ${para(HI_SENTENCE, words)}`;
  return {
    meta: {
      en: {
        title: 'EMI calculator for home loans, with formula',
        description:
          'See the monthly EMI, total interest and total payment for a home loan, with the formula and a worked example.',
      },
      hi: {
        title: 'होम लोन EMI कैलकुलेटर, फ़ॉर्मूले के साथ',
        description:
          'होम लोन की मासिक EMI, कुल ब्याज और कुल भुगतान देखें — फ़ॉर्मूले और एक उदाहरण के साथ, आसान भाषा में।',
      },
    },
    faq: {
      en: [
        { q: 'What is an EMI?', a: 'A fixed monthly payment that covers interest and principal.' },
        { q: 'Does the rate change?', a: 'The tool assumes a fixed rate. Ask your bank.' },
        { q: 'Is my data sent anywhere?', a: 'No. The calculation runs on your phone.' },
      ],
      hi: [
        { q: 'EMI क्या है?', a: 'हर महीने की तय किस्त जिसमें ब्याज और मूलधन दोनों होते हैं।' },
        { q: 'क्या दर बदलती है?', a: 'यह टूल तय दर मानता है। अपने बैंक से पूछें।' },
        { q: 'क्या मेरा डेटा कहीं जाता है?', a: 'नहीं। गणना आपके फ़ोन पर ही होती है।' },
      ],
    },
    articles: {
      en: {
        intro: en('For a loan of [[principal]] the EMI is [[emi]].'),
        how_to_use: en('1. Enter the loan amount.'),
        formula_explained: en('P is the loan amount and r is the monthly rate.'),
        when_to_use: en('Use it when a buyer asks about the monthly payment.'),
      },
      hi: {
        intro: hi('[[principal]] के लोन पर EMI [[emi]] होती है।'),
        how_to_use: hi('1. लोन राशि डालें।'),
        formula_explained: hi('P लोन राशि है और r मासिक दर है।'),
        when_to_use: hi('जब खरीदार मासिक किस्त पूछे तब इसका उपयोग करें।'),
      },
    },
  };
}
