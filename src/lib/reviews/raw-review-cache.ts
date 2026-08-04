/**
 * Shared raw-review cache + singleflight for PREVIEW_REVIEWS and FULL_PRODUCT_ANALYSIS.
 * Avoids collecting the same product's reviews twice in a short window.
 */

import type { CollectedReviews } from '@/lib/reviews/collect-reviews';
import { toCanonicalProductUrl } from '@/utils/product-url';

const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  value: CollectedReviews;
  savedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CollectedReviews>>();

function reviewCacheKey(marketplace: string, productUrl: string): string {
  const canonical = toCanonicalProductUrl(productUrl) || productUrl.split('?')[0].split('#')[0];
  return `${marketplace}:${canonical}`;
}

export function getCachedCollectedReviews(
  marketplace: string,
  productUrl: string,
): CollectedReviews | null {
  const key = reviewCacheKey(marketplace, productUrl);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedCollectedReviews(
  marketplace: string,
  productUrl: string,
  value: CollectedReviews,
): void {
  const key = reviewCacheKey(marketplace, productUrl);
  cache.set(key, { value, savedAt: Date.now() });
}

/**
 * One in-flight collect per product URL; also returns TTL cache hit.
 */
export async function withSharedReviewCollect(
  marketplace: string,
  productUrl: string,
  fn: () => Promise<CollectedReviews>,
): Promise<CollectedReviews> {
  const cached = getCachedCollectedReviews(marketplace, productUrl);
  if (cached && !cached.insufficient && cached.reviews.length > 0) {
    return cached;
  }

  const key = reviewCacheKey(marketplace, productUrl);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = fn()
    .then((result) => {
      if (result.reviews.length > 0) {
        setCachedCollectedReviews(marketplace, productUrl, result);
      }
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}
