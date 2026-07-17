/**
 * Модуль AI-анализа отзывов.
 *
 * Поток: popup → ANALYZE_REVIEWS (background) → collectReviewsForProduct
 *       → analyzeReviewTexts → cache → UI (ReviewsTab)
 */

export { findTabForProduct, normalizeProductTabUrl } from '@/lib/reviews/tab-resolver';
export { getReviewCacheKey, cacheKeyMatchesProduct } from '@/lib/reviews/cache-key';
export type { ReviewCacheProductRef } from '@/lib/reviews/cache-key';
export { parseWbFeedbackEntry, parseWbFeedbacksPayload } from '@/lib/reviews/wb-feedbacks';
export type { WbReviewItem, WbFeedbackEntry } from '@/lib/reviews/wb-feedbacks';
export { collectReviewsForProduct } from '@/lib/reviews/collect-reviews';
export type { CollectedReviews, ReviewCollectSource } from '@/lib/reviews/collect-reviews';
export { resolveReviewTarget, classifyReviewInput } from '@/lib/reviews/resolve-target';
export type { ResolvedReviewTarget, ReviewInputKind } from '@/lib/reviews/resolve-target';
export { loadReviewProductFromInput } from '@/lib/reviews/load-review-product';
export { scrapeReviewsFromActiveTab } from '@/lib/reviews/scrape-active-tab';

export {
  analyzeReviewTexts,
  analyzeReviews,
} from '@/lib/ai-analysis';

export {
  getCachedAnalysis,
  saveCachedAnalysis,
  shouldReturnCachedAnalysis,
  buildAnalysisComparison,
  isStableCachedAnalysis,
  hashReviews,
} from '@/lib/review-cache';
export type { CachedReviewAnalysis } from '@/lib/review-cache';

export type {
  ReviewAnalysisInput,
  ReviewAnalysisResult,
  ReviewFilter,
  FakeRiskLevel,
  PurchaseVerdict,
  AiProvider,
  RawAiReviewResponse,
} from '@/types/review-analysis';

export {
  MIN_REVIEWS_FOR_ANALYSIS,
  VERDICT_LABELS,
  FAKE_RISK_LABELS,
} from '@/types/review-analysis';
