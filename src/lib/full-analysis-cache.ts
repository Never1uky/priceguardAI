import { getReviewCacheKey } from '@/lib/reviews/cache-key';
import { hashReviews } from '@/lib/review-cache';
import { AI_CACHE_CONFIG } from '@/lib/ai/cache-config';
import { canonicalProductId } from '@/lib/ai/canonical-product-id';
import {
  computeAiCacheConfidence,
  decideAiCacheReuse,
  featuresFromTitle,
  refineCacheReasonForSource,
  type DecideAiCacheReuseResult,
} from '@/lib/ai/cache-confidence';
import type { ProductFeatures } from '@/lib/product-features';
import type { AiCacheReason } from '@/lib/ai/cache-config';
import type { FullProductAnalysis } from '@/types/full-analysis';

const CACHE_KEY = 'priceguard_full_analysis_cache';

/** @deprecated use AI_CACHE_CONFIG.localTtlMs */
export const FULL_ANALYSIS_LOCAL_TTL_MS = AI_CACHE_CONFIG.localTtlMs;
/** @deprecated use AI_CACHE_CONFIG.priceDeltaPct */
export const FULL_ANALYSIS_PRICE_DELTA_PCT = AI_CACHE_CONFIG.priceDeltaPct;
/** @deprecated use AI_CACHE_CONFIG.priceDeltaAbs */
export const FULL_ANALYSIS_PRICE_DELTA_ABS = AI_CACHE_CONFIG.priceDeltaAbs;

export interface FullAnalysisCacheEntry {
  result: FullProductAnalysis;
  reviewsHash: string;
  savedAt: number;
  /** Fingerprint brand|model|storage|article — цена не входит (legacy) */
  cardFingerprint?: string;
  /** Price at save — used to invalidate on significant change */
  priceAtSave?: number;
  /** Structured features for confidence scoring */
  features?: ProductFeatures;
  canonicalProductId?: string | null;
  productTitle?: string;
  article?: string;
}

export type FullAnalysisCacheDecision = DecideAiCacheReuseResult & {
  cacheReason: AiCacheReason;
};

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

/** True if current price diverged enough from cached priceAtSave. */
export function isSignificantPriceChange(
  priceAtSave: number | undefined,
  currentPrice: number | undefined,
): boolean {
  if (priceAtSave == null || !(priceAtSave > 0)) return false;
  if (currentPrice == null || !(currentPrice > 0)) return false;
  const abs = Math.abs(currentPrice - priceAtSave);
  const pct = AI_CACHE_CONFIG.priceDeltaPct;
  const absMin = AI_CACHE_CONFIG.priceDeltaAbs;
  if (abs < absMin && abs < priceAtSave * pct) {
    return false;
  }
  return abs >= absMin || abs >= priceAtSave * pct;
}

export async function getCachedFullAnalysis(
  ref: FullAnalysisCacheRef,
): Promise<FullAnalysisCacheEntry | null> {
  const key = getReviewCacheKey(ref);
  const store = await readStore();
  const entry = store[key] ?? null;
  if (!entry) return null;
  return entry;
}

/** Entry is within TTL (for soft refresh / early return without review hash). */
export function isFreshFullAnalysisCache(cached: FullAnalysisCacheEntry | null): boolean {
  if (!cached) return false;
  return Date.now() - cached.savedAt <= AI_CACHE_CONFIG.localTtlMs;
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
  priceAtSave?: number,
  meta?: {
    features?: ProductFeatures;
    productTitle?: string;
    article?: string;
  },
): Promise<void> {
  const key = getReviewCacheKey(ref);
  const store = await readStore();

  const features =
    meta?.features ??
    (meta?.productTitle ? featuresFromTitle(meta.productTitle) : undefined);
  const canon = features ? canonicalProductId(features) : null;

  store[key] = {
    result,
    reviewsHash: hashReviews(reviews),
    savedAt: Date.now(),
    cardFingerprint,
    priceAtSave: priceAtSave != null && priceAtSave > 0 ? priceAtSave : undefined,
    features,
    canonicalProductId: canon,
    productTitle: meta?.productTitle,
    article: meta?.article ?? ref.article,
  };

  await writeStore(store);
}

function resolveCachedFeatures(
  cached: FullAnalysisCacheEntry,
  fallbackTitle?: string,
): ProductFeatures {
  if (cached.features) return cached.features;
  const title = cached.productTitle || fallbackTitle || '';
  return featuresFromTitle(title || 'Товар');
}

/**
 * Confidence-based local cache gate (replaces binary fingerprint equality).
 */
export function evaluateLocalFullAnalysisCache(params: {
  cached: FullAnalysisCacheEntry | null;
  reviews: string[];
  forceRefresh?: boolean;
  softRefresh?: boolean;
  webResearch?: boolean;
  currentTitle: string;
  currentArticle?: string;
  currentPrice?: number;
  sameSku?: boolean;
}): FullAnalysisCacheDecision | { reuse: false; reason: 'NEW_ANALYSIS'; score: number; cacheReason: 'NEW_ANALYSIS' } {
  const {
    cached,
    reviews,
    forceRefresh,
    softRefresh,
    webResearch,
    currentTitle,
    currentArticle,
    currentPrice,
    sameSku = true,
  } = params;

  if (!cached || forceRefresh || webResearch) {
    return { reuse: false, reason: 'NEW_ANALYSIS', score: 0, cacheReason: 'NEW_ANALYSIS' };
  }

  const fresh = isFreshFullAnalysisCache(cached);
  const current = featuresFromTitle(currentTitle);
  const cachedFeat = resolveCachedFeatures(cached, currentTitle);
  const conf = computeAiCacheConfidence(current, cachedFeat, {
    article: currentArticle,
    cachedArticle: cached.article,
  });

  const reviewsHashMatch =
    reviews.length > 0 && cached.reviewsHash === hashReviews(reviews);

  const decided = decideAiCacheReuse({
    forceRefresh,
    softRefresh,
    webResearch,
    sameSku,
    reviewsHashMatch,
    confidence: conf.score,
    hardReject: conf.hardReject,
    significantPriceChange: isSignificantPriceChange(cached.priceAtSave, currentPrice),
    fresh,
  });

  const cacheReason = refineCacheReasonForSource(decided.reason, 'local');
  return { ...decided, cacheReason };
}

/**
 * @deprecated Prefer evaluateLocalFullAnalysisCache — kept for tests/compat.
 */
export function shouldReturnCachedFullAnalysis(
  cached: FullAnalysisCacheEntry | null,
  reviews: string[],
  forceRefresh?: boolean,
  cardFingerprint?: string,
  currentPrice?: number,
): boolean {
  void cardFingerprint;
  const decision = evaluateLocalFullAnalysisCache({
    cached,
    reviews,
    forceRefresh,
    currentTitle: cached?.productTitle || cached?.features?.title || 'Товар',
    currentArticle: cached?.article,
    currentPrice,
    sameSku: true,
  });
  return decision.reuse;
}

export function isStaleFullAnalysisCache(
  cached: FullAnalysisCacheEntry | null,
  reviews: string[],
): boolean {
  if (!cached) return false;
  return cached.reviewsHash !== hashReviews(reviews);
}
