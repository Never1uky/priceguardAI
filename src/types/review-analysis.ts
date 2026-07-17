export type AiProvider = 'claude' | 'grok' | 'openai';

export type FakeRiskLevel = 'low' | 'medium' | 'high';

export type PurchaseVerdict = 'buy_now' | 'wait_discount' | 'not_recommended';

/** Минимум отзывов для выдачи вердикта и уведомлений */
export const MIN_REVIEWS_FOR_ANALYSIS = 5;

export const VERDICT_LABELS: Record<PurchaseVerdict, string> = {
  buy_now: 'Купить сейчас',
  wait_discount: 'Подождать скидки',
  not_recommended: 'Не рекомендую',
};

/** Яркие заголовки для блока рекомендации */
export const VERDICT_HEADLINES: Record<PurchaseVerdict, string> = {
  buy_now: 'Рекомендую купить',
  wait_discount: 'Лучше подождать',
  not_recommended: 'Не рекомендую',
};

export const FAKE_RISK_LABELS: Record<FakeRiskLevel, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
};

export type ReviewFilter = 'all' | 'negative' | 'with_photo' | 'last_month';

export interface ReviewAnalysisInput {
  reviews: string[];
  /** Оценки 1–5 из API/DOM (по индексу с reviews) */
  reviewRatings?: Array<number | undefined>;
  productTitle: string;
  productPrice?: number;
  marketplace?: string;
  totalReviewsFound?: number;
}

export interface ReviewAnalysisResult {
  /** Общий рейтинг 1–5 на основе отзывов */
  overallRating: number;
  pros: string[];
  cons: string[];
  fakeRisk: FakeRiskLevel;
  fakeRiskExplanation: string;
  verdict: PurchaseVerdict;
  /** Краткое резюме анализа */
  summary: string;
  reviewsAnalyzed: number;
  /** Всего отзывов найдено на странице / в API */
  totalReviewsFound: number;
  source: AiProvider | 'local';
  providerLabel: string;
  /** Сравнение с прошлым анализом (если есть) */
  comparisonNote?: string;
}

export interface AiProviderConfig {
  provider: AiProvider;
  apiKey: string;
}

export interface RawAiReviewResponse {
  overallRating: number;
  pros: string[];
  cons: string[];
  fakeRisk: FakeRiskLevel;
  fakeRiskExplanation: string;
  verdict: PurchaseVerdict;
  summary: string;
}
