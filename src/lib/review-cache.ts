import { getReviewCacheKey } from '@/lib/reviews/cache-key';
import type { ReviewCacheProductRef } from '@/lib/reviews/cache-key';
import { VERDICT_LABELS } from '@/types/review-analysis';
import type { ReviewAnalysisResult } from '@/types/review-analysis';
import { MIN_REVIEWS_FOR_ANALYSIS } from '@/types/review-analysis';

const CACHE_KEY = 'priceguard_review_cache';

/** В течение этого окна повторный анализ не меняет вердикт без forceReanalyze */
const STABLE_CACHE_MIN_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов

/** Максимальный срок доверия кэшу при небольшом изменении числа отзывов */
const STABLE_CACHE_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней

export interface CachedReviewAnalysis {
  cacheKey: string;
  productUrl?: string;
  productId?: string;
  result: ReviewAnalysisResult;
  analyzedAt: number;
  reviewsHash?: string;
}

/** Устойчивый отпечаток набора отзывов — head + mid + tail. */
export function hashReviews(reviews: string[]): string {
  const count = reviews.length;
  const sampleHead = reviews
    .slice(0, 5)
    .map((r) => r.slice(0, 48).replace(/\s+/g, ' '))
    .join('\x1e');
  const midStart = Math.max(0, Math.floor(count / 2) - 1);
  const sampleMid = reviews
    .slice(midStart, midStart + 3)
    .map((r) => r.slice(0, 48).replace(/\s+/g, ' '))
    .join('\x1e');
  const sampleTail = reviews
    .slice(-3)
    .map((r) => r.slice(0, 48).replace(/\s+/g, ' '))
    .join('\x1e');
  return `${count}|${sampleHead}|${sampleMid}|${sampleTail}`;
}

function reviewCountFromHash(hash?: string): number {
  if (!hash) return 0;
  const count = parseInt(hash.split('|')[0] ?? '0', 10);
  return Number.isFinite(count) ? count : 0;
}

function reviewCountsSimilar(cachedHash: string | undefined, currentReviews: string[]): boolean {
  const oldCount = reviewCountFromHash(cachedHash);
  const newCount = currentReviews.length;
  if (oldCount === 0 || newCount === 0) return false;
  const delta = Math.abs(newCount - oldCount) / Math.max(oldCount, 1);
  return delta <= 0.12;
}

async function readCacheStore(): Promise<Record<string, CachedReviewAnalysis>> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  return (stored[CACHE_KEY] as Record<string, CachedReviewAnalysis>) ?? {};
}

function resolveCacheEntry(
  cache: Record<string, CachedReviewAnalysis>,
  ref: ReviewCacheProductRef,
): CachedReviewAnalysis | null {
  const primaryKey = getReviewCacheKey(ref);
  if (cache[primaryKey]) return cache[primaryKey];

  if (ref.id && cache[ref.id]) return cache[ref.id];

  if (ref.id) {
    const byLegacyId = Object.values(cache).find((entry) => entry.productId === ref.id);
    if (byLegacyId) return byLegacyId;
  }

  return null;
}

export async function getCachedAnalysis(ref: ReviewCacheProductRef): Promise<CachedReviewAnalysis | null> {
  const cache = await readCacheStore();
  return resolveCacheEntry(cache, ref);
}

export function isStableCachedAnalysis(
  cached: CachedReviewAnalysis | null,
): cached is CachedReviewAnalysis {
  return Boolean(cached && cached.result.reviewsAnalyzed >= MIN_REVIEWS_FOR_ANALYSIS);
}

export function shouldReturnCachedAnalysis(
  cached: CachedReviewAnalysis | null,
  reviews: string[],
  forceReanalyze?: boolean,
): boolean {
  if (forceReanalyze) return false;
  if (!isStableCachedAnalysis(cached)) return false;

  const age = Date.now() - cached.analyzedAt;
  const currentHash = hashReviews(reviews);

  // Свежий кэш — всегда отдаём (меньше «прыгающего» вердикта при повторных кликах)
  if (age < STABLE_CACHE_MIN_TTL_MS) return true;

  if (cached.reviewsHash === currentHash) return true;

  // Небольшое изменение числа отзывов в пределах TTL — сохраняем стабильность
  if (
    age < STABLE_CACHE_MAX_TTL_MS &&
    reviewCountsSimilar(cached.reviewsHash, reviews) &&
    reviews.length >= MIN_REVIEWS_FOR_ANALYSIS
  ) {
    return true;
  }

  return false;
}

export async function saveCachedAnalysis(
  ref: ReviewCacheProductRef,
  result: ReviewAnalysisResult,
  reviews?: string[],
): Promise<CachedReviewAnalysis | null> {
  const cache = await readCacheStore();
  const cacheKey = getReviewCacheKey(ref);
  const previous = resolveCacheEntry(cache, ref);

  const entry: CachedReviewAnalysis = {
    cacheKey,
    productUrl: ref.url,
    productId: ref.id,
    result,
    analyzedAt: Date.now(),
    reviewsHash: reviews ? hashReviews(reviews) : previous?.reviewsHash,
  };

  const nextCache = { ...cache, [cacheKey]: entry };

  if (ref.id && ref.id !== cacheKey) {
    delete nextCache[ref.id];
  }

  await chrome.storage.local.set({ [CACHE_KEY]: nextCache });

  return previous;
}

export function buildAnalysisComparison(
  current: ReviewAnalysisResult,
  previous: ReviewAnalysisResult | null,
): string | null {
  if (!previous) return null;

  const ratingDiff = current.overallRating - previous.overallRating;
  const ratingText =
    Math.abs(ratingDiff) < 0.1
      ? 'без изменений'
      : ratingDiff > 0
        ? `вырос с ${previous.overallRating.toFixed(1)} до ${current.overallRating.toFixed(1)}`
        : `снизился с ${previous.overallRating.toFixed(1)} до ${current.overallRating.toFixed(1)}`;

  const verdictChanged =
    current.verdict !== previous.verdict
      ? ` Вердикт: «${VERDICT_LABELS[previous.verdict]}» → «${VERDICT_LABELS[current.verdict]}».`
      : '';

  return `Рейтинг ${ratingText}.${verdictChanged}`;
}
