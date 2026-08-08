import { describe, expect, it } from 'vitest';
import {
  SEO_MIN_QUALITY_SCORE,
  SEO_MIN_REVIEWS,
  evaluateSeoPublishGates,
  normalizeQualityScoreForSeo,
  normalizeSeoImageUrl,
  sanitizeSeoProductTitle,
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
  pros: ['Звук', 'Автономность'],
  cons: ['Микрофон'],
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

  it('rejects missing score', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: { ...goodAnalysis, qualityScore: null },
        reviewCount: 10,
      }).reason,
    ).toBe('empty_analysis');
  });

  it('accepts legacy 80 as score 8 after normalize', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: { ...goodAnalysis, qualityScore: 80 },
        reviewCount: 10,
      }),
    ).toEqual({ ok: true });
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

  it('rejects thin pros/cons', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: { ...goodAnalysis, pros: ['one'], cons: [] },
        reviewCount: 10,
      }).reason,
    ).toBe('thin_content');
  });

  it('rejects weak titles', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: goodAnalysis,
        reviewCount: 10,
        title: '12345',
      }).reason,
    ).toBe('weak_title');
  });

  it('allows title with SEO Smoke after sanitize (clean product name remains)', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: goodAnalysis,
        reviewCount: 10,
        title: 'Xiaomi Redmi Buds 6 Active SEO Smoke',
      }),
    ).toEqual({ ok: true });
  });

  it('rejects title that is only SEO Smoke', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: goodAnalysis,
        reviewCount: 10,
        title: 'SEO Smoke',
      }).reason,
    ).toBe('weak_title');
  });
});

describe('sanitizeSeoProductTitle', () => {
  it('strips fixture markers and marketplace labels', () => {
    expect(sanitizeSeoProductTitle('Xiaomi Redmi Buds 6 Active SEO Smoke')).toBe(
      'Xiaomi Redmi Buds 6 Active',
    );
    expect(sanitizeSeoProductTitle('Redmi Buds — Wildberries')).toBe('Redmi Buds');
    expect(sanitizeSeoProductTitle('Ozon: Redmi Buds')).toBe('Redmi Buds');
  });
});

describe('normalizeQualityScoreForSeo', () => {
  it('keeps 1–10 and maps legacy 11–100', () => {
    expect(normalizeQualityScoreForSeo(8)).toBe(8);
    expect(normalizeQualityScoreForSeo(80)).toBe(8);
    expect(normalizeQualityScoreForSeo(null)).toBeNull();
    expect(normalizeQualityScoreForSeo(0)).toBeNull();
  });
});

describe('normalizeSeoImageUrl', () => {
  it('treats null/empty/invalid the same', () => {
    expect(normalizeSeoImageUrl(null)).toBeNull();
    expect(normalizeSeoImageUrl(undefined)).toBeNull();
    expect(normalizeSeoImageUrl('')).toBeNull();
    expect(normalizeSeoImageUrl('  ')).toBeNull();
    expect(normalizeSeoImageUrl('not-a-url')).toBeNull();
    expect(normalizeSeoImageUrl('https://cdn.example/a.webp')).toBe(
      'https://cdn.example/a.webp',
    );
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
