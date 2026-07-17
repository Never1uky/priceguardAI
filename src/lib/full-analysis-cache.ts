import { getReviewCacheKey } from '@/lib/reviews/cache-key';
import { hashReviews } from '@/lib/review-cache';
import { cardFingerprintsMatch } from '@/lib/card-fingerprint';
import type { FullProductAnalysis } from '@/types/full-analysis';

const CACHE_KEY = 'priceguard_full_analysis_cache';

export interface FullAnalysisCacheEntry {
  result: FullProductAnalysis;
  reviewsHash: string;
  savedAt: number;
  /** Fingerprint brand|model|storage|article — цена не входит */
  cardFingerprint?: string;
}

type CacheStore = Record<string, FullAnalysisCacheEntry>;

async function readStore(): Promise<CacheStore> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  return (stored[CACHE_KEY] as CacheStore) ?? {};
}

async function writeStore(store: CacheStore): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: store });
}

export interface FullAnalysisCacheRef {
  url: string;
  marketplace?: string;
  article?: string;
  id?: string;
}

export { hashReviews };

export async function getCachedFullAnalysis(
  ref: FullAnalysisCacheRef,
): Promise<FullAnalysisCacheEntry | null> {
  const key = getReviewCacheKey(ref);
  const store = await readStore();
  return store[key] ?? null;
}

/** Последний успешный анализ (даже если отзывы изменились) — для fallback при сбое AI */
export async function getStaleCachedFullAnalysis(
  ref: FullAnalysisCacheRef,
): Promise<FullAnalysisCacheEntry | null> {
  return getCachedFullAnalysis(ref);
}

export async function saveCachedFullAnalysis(
  ref: FullAnalysisCacheRef,
  result: FullProductAnalysis,
  reviews: string[],
  cardFingerprint?: string,
): Promise<void> {
  const key = getReviewCacheKey(ref);
  const store = await readStore();

  store[key] = {
    result,
    reviewsHash: hashReviews(reviews),
    savedAt: Date.now(),
    cardFingerprint,
  };

  await writeStore(store);
}

export function shouldReturnCachedFullAnalysis(
  cached: FullAnalysisCacheEntry | null,
  reviews: string[],
  forceRefresh?: boolean,
  cardFingerprint?: string,
): boolean {
  if (!cached || forceRefresh) return false;
  if (cached.reviewsHash !== hashReviews(reviews)) return false;
  if (!cardFingerprintsMatch(cached.cardFingerprint, cardFingerprint)) return false;
  return true;
}

export function isStaleFullAnalysisCache(
  cached: FullAnalysisCacheEntry | null,
  reviews: string[],
): boolean {
  if (!cached) return false;
  return cached.reviewsHash !== hashReviews(reviews);
}
