import { describe, expect, it } from 'vitest';
import {
  hashReviews,
  isSignificantPriceChange,
  shouldReturnCachedFullAnalysis,
  type FullAnalysisCacheEntry,
} from '@/lib/full-analysis-cache';

describe('isSignificantPriceChange', () => {
  it('false when missing prices', () => {
    expect(isSignificantPriceChange(undefined, 1000)).toBe(false);
    expect(isSignificantPriceChange(1000, undefined)).toBe(false);
  });

  it('false for small moves', () => {
    expect(isSignificantPriceChange(10_000, 10_400)).toBe(false);
  });

  it('true for ≥10%', () => {
    expect(isSignificantPriceChange(10_000, 11_000)).toBe(true);
  });

  it('true for ≥500₽ on expensive items under 10%', () => {
    expect(isSignificantPriceChange(20_000, 20_600)).toBe(true);
  });
});

describe('shouldReturnCachedFullAnalysis price gate', () => {
  const reviews = ['ok'];
  const entry: FullAnalysisCacheEntry = {
    result: {} as FullAnalysisCacheEntry['result'],
    reviewsHash: hashReviews(reviews),
    savedAt: Date.now(),
    cardFingerprint: 'brand|model',
    priceAtSave: 10_000,
    productTitle: 'Apple iPhone 15 256GB',
    article: '123',
  };

  it('hits when price stable', () => {
    expect(
      shouldReturnCachedFullAnalysis(entry, reviews, false, 'brand|model', 10_200),
    ).toBe(true);
  });

  it('misses when price jumped', () => {
    expect(
      shouldReturnCachedFullAnalysis(entry, reviews, false, 'brand|model', 12_000),
    ).toBe(false);
  });
});
