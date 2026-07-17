import { describe, expect, it } from 'vitest';
import {
  hashReviews,
  isStableCachedAnalysis,
  shouldReturnCachedAnalysis,
} from '@/lib/review-cache';
import type { CachedReviewAnalysis } from '@/lib/review-cache';
import type { ReviewAnalysisResult } from '@/types/review-analysis';

const baseResult: ReviewAnalysisResult = {
  overallRating: 4.2,
  verdict: 'buy_now',
  summary: 'test',
  pros: ['ok'],
  cons: [],
  fakeRisk: 'low',
  fakeRiskExplanation: 'low',
  reviewsAnalyzed: 12,
  totalReviewsFound: 12,
  source: 'local',
  providerLabel: 'test',
};

function makeCache(overrides?: Partial<CachedReviewAnalysis>): CachedReviewAnalysis {
  return {
    cacheKey: 'test',
    result: baseResult,
    analyzedAt: Date.now(),
    reviewsHash: hashReviews(Array.from({ length: 12 }, (_, i) => `review ${i}`)),
    ...overrides,
  };
}

describe('review-cache stability', () => {
  it('hashReviews is stable for same input', () => {
    const reviews = ['a', 'b', 'c', 'd'];
    expect(hashReviews(reviews)).toBe(hashReviews(reviews));
  });

  it('returns fresh stable cache within min TTL even if hash differs slightly', () => {
    const reviews = Array.from({ length: 12 }, (_, i) => `text ${i}`);
    const cached = makeCache({ analyzedAt: Date.now() - 60_000 });
    expect(shouldReturnCachedAnalysis(cached, reviews, false)).toBe(true);
  });

  it('skips cache when forceReanalyze', () => {
    const reviews = Array.from({ length: 12 }, (_, i) => `text ${i}`);
    const cached = makeCache();
    expect(shouldReturnCachedAnalysis(cached, reviews, true)).toBe(false);
  });

  it('isStableCachedAnalysis requires minimum reviews', () => {
    expect(isStableCachedAnalysis(makeCache())).toBe(true);
    expect(
      isStableCachedAnalysis(
        makeCache({
          result: { ...baseResult, reviewsAnalyzed: 2 },
        }),
      ),
    ).toBe(false);
  });
});
