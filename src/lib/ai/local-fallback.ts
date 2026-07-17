import type {
  FakeRiskLevel,
  PurchaseVerdict,
  RawAiReviewResponse,
  ReviewAnalysisInput,
  ReviewAnalysisResult,
} from '@/types/review-analysis';
import { VERDICT_LABELS } from '@/types/review-analysis';

const POSITIVE_WORDS = [
  'отличн', 'хорош', 'рекоменд', 'качеств', 'доволен', 'супер', 'класс', 'удобн',
  'быстр', 'красив', 'нравит', 'топ', 'замечательн', 'прекрасн', 'стоит', 'идеальн',
  'понрав', 'отлично', 'превосход', 'благодар',
];

const NEGATIVE_WORDS = [
  'плох', 'брак', 'разочар', 'вернул', 'обман', 'ужас', 'не рекоменд', 'сломал',
  'дефект', 'некачеств', 'жалоб', 'отврат', 'мусор', 'неудобн', 'не соответств',
  'разочаров', 'не купил', 'не советую', 'отвратительн', 'худш',
];

const TEMPLATE_PHRASES = [
  'рекомендую',
  'отличный товар',
  'всё супер',
  'все супер',
  'пять звезд',
  '5 звезд',
  'заказываю не первый раз',
];

/** Извлечь оценку 1–5 из текста отзыва */
function parseRatingFromText(text: string): number | null {
  const lower = text.toLowerCase();

  const explicit = lower.match(/(?:оценк[аи]|рейтинг|звезд[аы]?|stars?)\s*[:\-]?\s*(\d(?:\.\d)?)/);
  if (explicit) {
    const v = parseFloat(explicit[1]);
    if (v >= 1 && v <= 5) return v;
  }

  const slash = lower.match(/\b([1-5])\s*\/\s*5\b/);
  if (slash) return parseInt(slash[1], 10);

  if (/\b(?:пять|5)\s*звезд/i.test(text) || /⭐{5}/.test(text)) return 5;
  if (/\b(?:четыре|4)\s*звезд/i.test(text) || /⭐{4}/.test(text)) return 4;
  if (/\b(?:три|3)\s*звезд/i.test(text) || /⭐{3}/.test(text)) return 3;
  if (/\b(?:два|2)\s*звезд/i.test(text) || /⭐{2}/.test(text)) return 2;
  if (/\b(?:одна|одну|1)\s*звезд/i.test(text) || /⭐/.test(text)) return 1;

  return null;
}

function countMatches(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  return words.reduce((acc, word) => (lower.includes(word) ? acc + 1 : acc), 0);
}

function reviewSentiment(text: string): number {
  const pos = countMatches(text, POSITIVE_WORDS);
  const neg = countMatches(text, NEGATIVE_WORDS);
  if (pos === 0 && neg === 0) return 0;
  return (pos - neg) / Math.max(pos + neg, 1);
}

function detectFakeRisk(reviews: string[]): { level: FakeRiskLevel; explanation: string } {
  if (reviews.length < 3) {
    return {
      level: 'medium',
      explanation: 'Мало отзывов для надёжной оценки — возможна выборочная накрутка.',
    };
  }

  const avgLength = reviews.reduce((sum, r) => sum + r.length, 0) / reviews.length;
  const templateHits = reviews.filter((r) =>
    TEMPLATE_PHRASES.some((phrase) => r.toLowerCase().includes(phrase)),
  ).length;

  const uniqueStarts = new Set(reviews.map((r) => r.slice(0, 40).toLowerCase())).size;
  const diversityRatio = uniqueStarts / reviews.length;

  if (avgLength < 60 && templateHits > reviews.length * 0.5) {
    return {
      level: 'high',
      explanation:
        'Много коротких шаблонных отзывов с одинаковыми фразами — высокая вероятность накрутки.',
    };
  }

  if (diversityRatio < 0.5 || templateHits > reviews.length * 0.35) {
    return {
      level: 'medium',
      explanation:
        'Заметна однотипность формулировок. Часть отзывов может быть ненастоящей.',
    };
  }

  return {
    level: 'low',
    explanation: 'Отзывы разнообразные и содержат конкретные детали — признаков массовой накрутки мало.',
  };
}

function pickVerdict(
  rating: number,
  fakeRisk: FakeRiskLevel,
  negativeShare: number,
  positiveShare: number,
): PurchaseVerdict {
  if (fakeRisk === 'high') return 'not_recommended';
  if (rating >= 4.3 && fakeRisk === 'low' && negativeShare < 0.25) return 'buy_now';
  if (rating >= 3.8 && negativeShare < 0.35) return 'wait_discount';
  if (rating < 3.0 || negativeShare > 0.55) return 'not_recommended';
  if (rating >= 3.3 && positiveShare >= negativeShare) return 'wait_discount';
  return 'not_recommended';
}

function computeOverallRating(
  reviews: string[],
  explicitRatings?: Array<number | undefined>,
): { rating: number; positiveShare: number; negativeShare: number } {
  const perReviewScores: number[] = [];

  for (let i = 0; i < reviews.length; i++) {
    const text = reviews[i];
    const explicit = explicitRatings?.[i];
    const fromText = parseRatingFromText(text);
    const sentiment = reviewSentiment(text);

    if (explicit != null && explicit >= 1 && explicit <= 5) {
      perReviewScores.push(explicit);
    } else if (fromText != null) {
      perReviewScores.push(fromText);
    } else {
      // Текст без звёзд: 3 ± sentiment
      perReviewScores.push(Math.min(5, Math.max(1, 3 + sentiment * 1.5)));
    }
  }

  const avg = perReviewScores.reduce((s, v) => s + v, 0) / perReviewScores.length;
  const positiveCount = perReviewScores.filter((s) => s >= 4).length;
  const negativeCount = perReviewScores.filter((s) => s <= 2.5).length;

  return {
    rating: Number(avg.toFixed(1)),
    positiveShare: positiveCount / perReviewScores.length,
    negativeShare: negativeCount / perReviewScores.length,
  };
}

function extractProsCons(reviews: string[]): { pros: string[]; cons: string[] } {
  const pros: string[] = [];
  const cons: string[] = [];
  const combined = reviews.join(' ').toLowerCase();

  const topicRules: Array<{ keys: string[]; pro: string; con: string }> = [
    { keys: ['качеств', 'прочн'], pro: 'Хвалят качество', con: 'Жалуются на качество' },
    { keys: ['удобн', 'эргоном'], pro: 'Удобен в использовании', con: 'Неудобен в использовании' },
    { keys: ['доставк', 'привезли', 'курьер'], pro: 'Хорошая доставка', con: 'Проблемы с доставкой' },
    { keys: ['соответств', 'как на фото', 'как в описан'], pro: 'Соответствует описанию', con: 'Не соответствует описанию' },
    { keys: ['батаре', 'аккумулятор', 'держит заряд'], pro: 'Хорошая автономность', con: 'Слабая автономность' },
    { keys: ['экран', 'дисплей', 'яркост'], pro: 'Хороший экран', con: 'Проблемы с экраном' },
    { keys: ['камер', 'фото', 'снимк'], pro: 'Хвалят камеру/фото', con: 'Разочарованы камерой/фото' },
    { keys: ['звук', 'динамик', 'громкост'], pro: 'Хороший звук', con: 'Слабый звук' },
    { keys: ['брак', 'дефект', 'сломал'], pro: '', con: 'Встречаются брак и поломки' },
    { keys: ['размер', 'маломер', 'великоват'], pro: '', con: 'Проблемы с размером' },
    { keys: ['запах'], pro: '', con: 'Неприятный запах' },
    { keys: ['цена', 'дорог', 'дешев'], pro: 'Считают цену оправданной', con: 'Считают цену завышенной' },
  ];

  for (const rule of topicRules) {
    if (!rule.keys.some((k) => combined.includes(k))) continue;
    const posHits = reviews.filter((r) => rule.keys.some((k) => r.toLowerCase().includes(k)) && reviewSentiment(r) > 0).length;
    const negHits = reviews.filter((r) => rule.keys.some((k) => r.toLowerCase().includes(k)) && reviewSentiment(r) < 0).length;
    if (rule.pro && posHits > negHits) pros.push(rule.pro);
    if (rule.con && negHits >= posHits && negHits > 0) cons.push(rule.con);
  }

  const positiveReviews = reviews.filter((r) => reviewSentiment(r) > 0.2).length;
  const negativeReviews = reviews.filter((r) => reviewSentiment(r) < -0.2).length;

  if (pros.length === 0 && positiveReviews > negativeReviews) {
    pros.push('Большинство отзывов положительные');
  }
  if (cons.length === 0 && negativeReviews > positiveReviews) {
    cons.push('Преобладает негативный опыт покупателей');
  } else if (cons.length === 0 && negativeReviews > 0) {
    cons.push('Есть отдельные негативные отзывы');
  }

  return { pros: pros.slice(0, 5), cons: cons.slice(0, 5) };
}

export function analyzeReviewsLocally(input: ReviewAnalysisInput): ReviewAnalysisResult {
  const { reviews, productTitle, productPrice, reviewRatings } = input;

  if (reviews.length === 0) {
    return {
      overallRating: 0,
      pros: [],
      cons: [],
      fakeRisk: 'medium',
      fakeRiskExplanation: 'Нет отзывов для анализа.',
      verdict: 'wait_discount',
      summary: 'Отзывы не найдены. Прокрутите страницу до раздела отзывов и повторите анализ.',
      reviewsAnalyzed: 0,
      totalReviewsFound: input.totalReviewsFound ?? 0,
      source: 'local',
      providerLabel: 'Локальный анализ',
    };
  }

  const { rating: overallRating, positiveShare, negativeShare } = computeOverallRating(
    reviews,
    reviewRatings,
  );
  const { pros, cons } = extractProsCons(reviews);
  const { level: fakeRisk, explanation: fakeRiskExplanation } = detectFakeRisk(reviews);
  const verdict = pickVerdict(overallRating, fakeRisk, negativeShare, positiveShare);

  const priceHint =
    productPrice && verdict === 'wait_discount'
      ? ` При цене ${productPrice} ₽ имеет смысл подождать скидку.`
      : '';

  const summary = `Проанализировано ${reviews.length} отзывов о «${productTitle.slice(0, 50)}». Средняя оценка ${overallRating}/5 (положительных ~${Math.round(positiveShare * 100)}%). Рекомендация: ${VERDICT_LABELS[verdict]}.${priceHint}`;

  return {
    overallRating,
    pros,
    cons,
    fakeRisk,
    fakeRiskExplanation,
    verdict,
    summary,
    reviewsAnalyzed: reviews.length,
    totalReviewsFound: input.totalReviewsFound ?? reviews.length,
    source: 'local',
    providerLabel: 'Локальный анализ',
  };
}

export function normalizeAiResponse(
  raw: RawAiReviewResponse,
  reviewsCount: number,
  providerLabel: string,
  source: 'claude' | 'grok' | 'openai',
  totalReviewsFound?: number,
): ReviewAnalysisResult {
  const overallRating = Math.min(5, Math.max(1, Number(raw.overallRating) || 3));

  const fakeRisk: FakeRiskLevel = ['low', 'medium', 'high'].includes(raw.fakeRisk)
    ? raw.fakeRisk
    : 'medium';

  const verdict: PurchaseVerdict = ['buy_now', 'wait_discount', 'not_recommended'].includes(raw.verdict)
    ? raw.verdict
    : 'wait_discount';

  return {
    overallRating,
    pros: (raw.pros ?? []).slice(0, 5),
    cons: (raw.cons ?? []).slice(0, 5),
    fakeRisk,
    fakeRiskExplanation: raw.fakeRiskExplanation || 'Оценка риска не предоставлена.',
    verdict,
    summary: raw.summary || `Рекомендация: ${VERDICT_LABELS[verdict]}`,
    reviewsAnalyzed: reviewsCount,
    totalReviewsFound: totalReviewsFound ?? reviewsCount,
    source,
    providerLabel,
  };
}
