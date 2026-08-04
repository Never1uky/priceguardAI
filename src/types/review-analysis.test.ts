import { describe, expect, it } from 'vitest';
import { MIN_REVIEWS_FOR_ANALYSIS, minReviewsForFullAnalysis } from '@/types/review-analysis';

describe('minReviewsForFullAnalysis', () => {
  it('Free → 5', () => {
    expect(minReviewsForFullAnalysis(false)).toBe(5);
    expect(minReviewsForFullAnalysis(false)).toBe(MIN_REVIEWS_FOR_ANALYSIS);
  });

  it('Premium/Trial → 0', () => {
    expect(minReviewsForFullAnalysis(true)).toBe(0);
  });
});
