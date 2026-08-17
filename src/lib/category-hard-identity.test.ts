import { describe, expect, it } from 'vitest';
import {
  areLineageGenerationsCompatible,
  extractLineageGeneration,
} from '@/lib/lineage-generation';
import { scoreProductMatch, computeMatchConfidence } from '@/lib/product-match';
import { inferProductCategory } from '@/lib/match-category';
import { pickSearchFromCandidates } from '@/utils/parsers/search-results';
import { extractProductFeatures, scoreFeatureMatch } from '@/lib/product-features';
import { offerIdentityFingerprint, isIdentityExcluded } from '@/lib/offer-identity';
import { markOfferRejectedKeepPool, getRejectedFingerprints } from '@/lib/candidate-pool';
import type { CompareProduct } from '@/types/comparison';

describe('category-aware hard identity (phones / memory cards / reject)', () => {
  it('smartphones: color soft — green vs Lemongrass still high model match', () => {
    const ref = 'Смартфон Google Pixel 7 8/128Gb Lemongrass';
    const green = 'Смартфон Google Pixel 7 8/128Gb зеленый';
    const fm = scoreFeatureMatch(extractProductFeatures(ref), extractProductFeatures(green), true);
    expect(fm.category).toBe('smartphones');
    expect(fm.breakdown.color ?? 0).toBeLessThan(5);
    expect(scoreProductMatch(ref, green)).toBeGreaterThan(0.7);
  });

  it('memory_cards: Go Plus Gen4 ≠ Select Plus Gen3', () => {
    const ref = 'Карта памяти Kingston microSDXC 128Gb Canvas Go Plus Gen4';
    const gen3 = 'Карта памяти MicroSD Kingston Canvas Select Plus Gen3 128GB';
    expect(inferProductCategory(ref)).toBe('memory_cards');
    expect(extractLineageGeneration(ref)?.lineage).toMatch(/go/);
    expect(extractLineageGeneration(gen3)?.lineage).toMatch(/select/);
    expect(areLineageGenerationsCompatible(ref, gen3)).toBe(false);
    expect(scoreProductMatch(ref, gen3)).toBeLessThanOrEqual(0.15);
  });

  it('memory_cards: cheap Gen3 does not win pickSearch top over Go Plus', () => {
    const ref = 'Карта памяти Kingston microSDXC 128Gb Canvas Go Plus Gen4';
    const { ranked, offer } = pickSearchFromCandidates(
      'yandex_market',
      'Kingston Canvas Go Plus Gen4 128',
      ref,
      [
        {
          title: 'Карта памяти MicroSD Kingston Canvas Select Plus Gen3 128GB',
          url: 'https://market.yandex.ru/card/select-gen3/111',
          price: 1641,
          rating: 5,
        },
        {
          title: 'Kingston Canvas Go! Plus 128 ГБ Gen4',
          url: 'https://market.yandex.ru/card/go-plus/222',
          price: 3990,
          rating: 4.5,
        },
      ],
      { referencePrice: 4000 },
    );
    if (offer.matchStatus === 'not_found') {
      // Gen3 filtered; Go may still rank
      expect(ranked.every((r) => !/select/i.test(r.candidate.title))).toBe(true);
    } else {
      expect(ranked[0]?.candidate.title).toMatch(/go/i);
      expect(ranked[0]?.candidate.title).not.toMatch(/select/i);
    }
  });

  it('reject fingerprint blocks same line+gen under new URL', () => {
    const product: CompareProduct = {
      id: 'p1',
      title: 'Kingston Canvas Go Plus Gen4',
      sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      sourceMarketplace: 'wildberries',
      marketplaceUrls: {},
      addedAt: Date.now(),
      marketplaceOffers: {
        yandex_market: {
          marketplace: 'yandex_market',
          title: 'Kingston',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://market.yandex.ru/search',
          found: false,
          needsManualPick: true,
          searchCandidates: [
            {
              title: 'Карта памяти MicroSD Kingston Canvas Select Plus Gen3 128GB',
              url: 'https://market.yandex.ru/card/select-a/111',
              price: 1641,
              matchConfidence: 40,
              priority: 100,
            },
          ],
        },
      },
    };
    const next = markOfferRejectedKeepPool(
      product,
      'yandex_market',
      'https://market.yandex.ru/card/select-a/111',
      {
        rejectedTitle: 'Карта памяти MicroSD Kingston Canvas Select Plus Gen3 128GB',
      },
    );
    const fps = getRejectedFingerprints(next, 'yandex_market');
    expect(fps.length).toBeGreaterThan(0);
    expect(
      isIdentityExcluded(
        'Kingston Canvas Select Plus Gen3 128GB other seller',
        'https://market.yandex.ru/card/select-b/999',
        'yandex_market',
        fps,
      ),
    ).toBe(true);
    const fp = offerIdentityFingerprint(
      'Карта памяти MicroSD Kingston Canvas Select Plus Gen3 128GB',
      'https://market.yandex.ru/card/select-a/111',
      'yandex_market',
    );
    expect(fp).toMatch(/select|gen3|111/i);
  });

  it('Pixel cheap same model still ranks above dear (regression)', () => {
    const ref = 'Смартфон Google Pixel 7 8/128Gb Lemongrass';
    const { ranked } = pickSearchFromCandidates(
      'yandex_market',
      'Google Pixel 7 128',
      ref,
      [
        {
          title: 'Смартфон Google Pixel 7 8/128Gb',
          url: 'https://market.yandex.ru/card/pixel-dear/1',
          price: 34549,
          rating: 5,
        },
        {
          title: 'Смартфон Google Pixel 7 8/128Gb Lemongrass',
          url: 'https://market.yandex.ru/card/pixel-cheap/2',
          price: 24682,
          rating: null,
        },
      ],
      { referencePrice: 23098 },
    );
    expect(ranked[0]?.candidate.price).toBe(24682);
    expect(computeMatchConfidence(ref, ranked[0]!.candidate.title)).toBeGreaterThanOrEqual(70);
  });
});
