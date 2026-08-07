import { describe, expect, it } from 'vitest';
import {
  SEO_MIN_QUALITY_SCORE,
  SEO_MIN_REVIEWS,
  evaluateSeoPublishGates,
} from './publish-gates.ts';
import {
  buildSeoProductSlug,
  canonicalPathForSlug,
  hashSeoAnalysis,
  productKey,
  resolveSeoSlugCollision,
  slugifySeoSegment,
  stableAnalysisPayloadForHash,
} from './slug.ts';

const goodAnalysis = {
  qualityScore: 8,
  qualitySummary: 'Хороший товар по отзывам.',
  verdictExplanation: 'Можно брать на скидке.',
  verdict: 'wait_discount',
  fakeRisk: 'low',
  webOverview: '',
  source: 'openai',
};

describe('seo publish gates', () => {
  it('passes solid analysis with enough reviews', () => {
    expect(
      evaluateSeoPublishGates({ analysis: goodAnalysis, reviewCount: SEO_MIN_REVIEWS }),
    ).toEqual({ ok: true });
  });

  it('rejects empty / invalid analysis', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: { ...goodAnalysis, qualitySummary: '' },
        reviewCount: 10,
      }).reason,
    ).toBe('empty_analysis');
  });

  it('rejects local source', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: { ...goodAnalysis, source: 'local' },
        reviewCount: 10,
      }).reason,
    ).toBe('local_source');
  });

  it('rejects low quality score', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: { ...goodAnalysis, qualityScore: SEO_MIN_QUALITY_SCORE - 1 },
        reviewCount: 10,
      }).reason,
    ).toBe('low_quality');
  });

  it('rejects insufficient reviews without web overview', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: goodAnalysis,
        reviewCount: SEO_MIN_REVIEWS - 1,
      }).reason,
    ).toBe('insufficient_reviews');
  });

  it('allows few reviews when web overview is long', () => {
    const web = 'x'.repeat(80);
    expect(
      evaluateSeoPublishGates({
        analysis: { ...goodAnalysis, webOverview: web },
        reviewCount: 0,
      }),
    ).toEqual({ ok: true });
  });
});

describe('seo slug + hash', () => {
  it('slugifies human titles', () => {
    expect(slugifySeoSegment('Apple AirPods Max USB-C')).toBe('apple-airpods-max-usb-c');
    expect(buildSeoProductSlug({
      brand: 'Apple',
      model: 'AirPods Max',
      storage: 'USB-C',
      marketplace: 'ozon',
      productId: '1',
    })).toBe('apple-airpods-max-usb-c');
  });

  it('falls back to marketplace-id', () => {
    expect(
      buildSeoProductSlug({ brand: '', model: '', marketplace: 'ozon', productId: '123' }),
    ).toBe('ozon-123');
  });

  it('resolves collisions', () => {
    expect(resolveSeoSlugCollision('apple-airpods', false, 'ozon', '1')).toBe('apple-airpods');
    expect(resolveSeoSlugCollision('apple-airpods', true, 'ozon', '1')).toBe('apple-airpods-ozon');
  });

  it('builds product key and canonical path', () => {
    expect(productKey('wildberries', '99')).toBe('wildberries:99');
    expect(canonicalPathForSlug('apple-airpods')).toBe('/a/apple-airpods');
  });

  it('hashes stably ignoring priceInsight', async () => {
    const a = {
      ...goodAnalysis,
      pros: ['a'],
      cons: ['b'],
      fakeRiskExplanation: 'ok',
      keySpecs: ['s'],
      hiddenProblems: [],
      alternatives: [],
      analogComparison: 'x',
      priceInsight: 'old',
      analyzedAt: 1,
    };
    const b = { ...a, priceInsight: 'new', analyzedAt: 999 };
    expect(stableAnalysisPayloadForHash(a)).toEqual(stableAnalysisPayloadForHash(b));
    expect(await hashSeoAnalysis(a)).toBe(await hashSeoAnalysis(b));
  });
});
