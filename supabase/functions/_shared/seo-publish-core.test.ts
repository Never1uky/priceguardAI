import { describe, expect, it } from 'vitest';
import {
  allocateUniqueSlug,
  asAnalysisRecord,
  averageMarketplaceRating,
  countRawReviews,
  seoRevalidatePaths,
} from './seo-publish-core.ts';
import { evaluateSeoPublishGates } from './seo-gates.ts';
import { buildSeoProductSlug, guessBrandModelFromTitle } from './seo-slug.ts';

describe('seo-publish-core', () => {
  it('counts reviews', () => {
    expect(countRawReviews(['a', '', 'b'])).toBe(2);
    expect(countRawReviews(null)).toBe(0);
    expect(countRawReviews([{ text: 'ok', rating: 5 }, { text: '' }])).toBe(1);
  });

  it('averages marketplace ratings honestly', () => {
    expect(averageMarketplaceRating([{ rating: 5 }, { rating: 4 }, { rating: 5 }])).toBe(
      4.7,
    );
    expect(averageMarketplaceRating([{ rating: 5 }, { rating: 4 }])).toBeNull();
    expect(averageMarketplaceRating(['text only'])).toBeNull();
  });

  it('parses analysis record', () => {
    expect(asAnalysisRecord({ qualityScore: 7 })).toEqual({ qualityScore: 7 });
    expect(asAnalysisRecord({})).toBeNull();
  });

  it('allocates unique slug', async () => {
    const taken = new Set(['apple-airpods']);
    const slug = await allocateUniqueSlug({
      desired: 'apple-airpods',
      marketplace: 'ozon',
      productId: '99',
      productKey: 'ozon:99',
      isTakenByOther: async (s) => taken.has(s),
    });
    expect(slug).toBe('apple-airpods-ozon');
  });

  it('builds revalidate paths', () => {
    expect(seoRevalidatePaths('x', 'apple', 'headphones')).toEqual([
      '/a/x',
      '/sitemap.xml',
      '/rss.xml',
      '/',
      '/brand/apple',
      '/category/headphones',
    ]);
  });

  it('guesses brand/model and slug', () => {
    expect(guessBrandModelFromTitle('Apple AirPods Max USB-C')).toEqual({
      brand: 'Apple',
      model: 'AirPods Max USB-C',
    });
    expect(
      buildSeoProductSlug({
        brand: 'Apple',
        model: 'AirPods Max',
        marketplace: 'ozon',
        productId: '1',
      }),
    ).toBe('apple-airpods-max');
  });

  it('gates reject local', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: {
          qualityScore: 8,
          qualitySummary: 'ok summary',
          verdictExplanation: 'ok verdict',
          verdict: 'buy_now',
          fakeRisk: 'low',
          source: 'local',
        },
        reviewCount: 10,
      }).reason,
    ).toBe('local_source');
  });
});
