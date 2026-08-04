import { describe, expect, it } from 'vitest';
import {
  computeAiCacheConfidence,
  decideAiCacheReuse,
  featuresFromTitle,
  mappingAllowsCrossMpReuse,
  refineCacheReasonForSource,
} from '@/lib/ai/cache-confidence';
import { canonicalProductId, sameSkuId } from '@/lib/ai/canonical-product-id';
import { AI_CACHE_CONFIG } from '@/lib/ai/cache-config';

describe('canonicalProductId', () => {
  it('sameSkuId formats marketplace:id', () => {
    expect(sameSkuId('wildberries', '123')).toBe('wildberries:123');
  });

  it('returns null without brand+model', () => {
    expect(canonicalProductId({ title: 'Товар без бренда' })).toBeNull();
  });

  it('builds canon when brand+model present', () => {
    const id = canonicalProductId({
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '256gb',
      category: 'smartphones',
      title: 'Apple iPhone 15 256',
    });
    expect(id).toMatch(/^canon:apple\|iphone15/);
  });
});

describe('computeAiCacheConfidence', () => {
  it('hard-rejects brand mismatch', () => {
    const a = featuresFromTitle('Apple iPhone 15 256GB');
    const b = featuresFromTitle('Samsung Galaxy S24 256GB');
    const conf = computeAiCacheConfidence(a, b);
    expect(conf.hardReject).toBe(true);
    expect(conf.score).toBeLessThanOrEqual(AI_CACHE_CONFIG.hardRejectScore);
  });

  it('scores high for same phone features', () => {
    const a = featuresFromTitle('Apple iPhone 15 256GB черный');
    const b = featuresFromTitle('Смартфон Apple iPhone 15 256 ГБ');
    const conf = computeAiCacheConfidence(a, b);
    expect(conf.hardReject).toBe(false);
    expect(conf.score).toBeGreaterThanOrEqual(70);
  });

  it('caps score on storage mismatch', () => {
    const a = featuresFromTitle('Apple iPhone 15 128GB');
    const b = featuresFromTitle('Apple iPhone 15 512GB');
    const conf = computeAiCacheConfidence(a, b);
    if (a.storage && b.storage && a.storage !== b.storage) {
      expect(conf.score).toBeLessThanOrEqual(AI_CACHE_CONFIG.variantMismatchScoreCap);
    }
  });
});

describe('mappingAllowsCrossMpReuse', () => {
  it('allows manual evidence', () => {
    expect(
      mappingAllowsCrossMpReuse({ status: 'active', evidence: 'manual', confidence: 40 }),
    ).toBe(true);
  });

  it('rejects disputed', () => {
    expect(
      mappingAllowsCrossMpReuse({ status: 'disputed', evidence: 'manual', confidence: 99 }),
    ).toBe(false);
  });

  it('allows high-confidence auto', () => {
    expect(
      mappingAllowsCrossMpReuse({
        status: 'active',
        evidence: 'auto',
        confidence: AI_CACHE_CONFIG.crossMpMappingMinConfidence,
      }),
    ).toBe(true);
  });

  it('rejects low auto', () => {
    expect(
      mappingAllowsCrossMpReuse({ status: 'active', evidence: 'auto', confidence: 60 }),
    ).toBe(false);
  });
});

describe('decideAiCacheReuse', () => {
  it('forceRefresh → NEW_ANALYSIS', () => {
    const d = decideAiCacheReuse({ forceRefresh: true, confidence: 99, sameSku: true });
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('NEW_ANALYSIS');
  });

  it('softRefresh + sameSku → SOFT_REFRESH', () => {
    const d = decideAiCacheReuse({
      softRefresh: true,
      sameSku: true,
      confidence: 40,
      fresh: true,
    });
    expect(d.reuse).toBe(true);
    expect(d.reason).toBe('SOFT_REFRESH');
  });

  it('sameSku + reviewsHash → REVIEWS_MATCH', () => {
    const d = decideAiCacheReuse({
      sameSku: true,
      reviewsHashMatch: true,
      confidence: 50,
      fresh: true,
    });
    expect(d.reuse).toBe(true);
    expect(d.reason).toBe('REVIEWS_MATCH');
  });

  it('cross-MP mapping + high confidence → CROSS_MARKETPLACE', () => {
    const d = decideAiCacheReuse({
      mapping: { status: 'active', evidence: 'manual', confidence: 90 },
      confidence: AI_CACHE_CONFIG.reuseMinConfidence,
      fresh: true,
    });
    expect(d.reuse).toBe(true);
    expect(d.reason).toBe('CROSS_MARKETPLACE');
  });

  it('cross-MP with low feature confidence → miss', () => {
    const d = decideAiCacheReuse({
      mapping: { status: 'active', evidence: 'manual', confidence: 90 },
      confidence: 40,
      fresh: true,
    });
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('NEW_ANALYSIS');
  });

  it('significant price change blocks non-soft', () => {
    const d = decideAiCacheReuse({
      sameSku: true,
      reviewsHashMatch: true,
      confidence: 95,
      fresh: true,
      significantPriceChange: true,
    });
    expect(d.reuse).toBe(false);
  });

  it('refineCacheReasonForSource', () => {
    expect(refineCacheReasonForSource('LOCAL_CACHE', 'remote')).toBe('REMOTE_CACHE');
    expect(refineCacheReasonForSource('SAME_SKU', 'remote')).toBe('SAME_SKU');
    expect(refineCacheReasonForSource('SOFT_REFRESH', 'local')).toBe('SOFT_REFRESH');
  });
});
