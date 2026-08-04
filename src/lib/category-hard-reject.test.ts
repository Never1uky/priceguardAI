import { describe, expect, it } from 'vitest';
import { scoreProductMatch } from '@/lib/product-match';
import {
  areCategoriesIncompatible,
  inferProductCategory,
  isTitleCategoryCompatible,
} from '@/lib/match-category';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import type { MarketplaceOffer } from '@/types/comparison';

describe('category A never matches category B', () => {
  it('Galaxy Buds vs iPhone → score 0 and incompatible', () => {
    const buds = 'Samsung Наушники Galaxy Buds3 Pro Silver';
    const phone = 'Смартфон Apple iPhone 17 Pro Max 256GB';
    expect(inferProductCategory(buds)).toBe('headphones');
    expect(inferProductCategory(phone)).toBe('smartphones');
    expect(areCategoriesIncompatible('headphones', 'smartphones')).toBe(true);
    expect(isTitleCategoryCompatible(buds, phone)).toBe(false);
    expect(scoreProductMatch(buds, phone)).toBe(0);
  });

  it('buildOfferFromRankedCandidates drops cross-category iPhone from buds query', () => {
    const budsOffer: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'TWS Наушники Galaxy Buds',
      price: 4090,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/buds-1/',
      found: true,
    };
    const phoneOffer: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Смартфон Apple iPhone 17 Pro',
      price: 113_813,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/iphone-1/',
      found: true,
    };

    const result = buildOfferFromRankedCandidates(
      'ozon',
      'Galaxy Buds3 Pro',
      'https://www.ozon.ru/search/?text=buds',
      [
        { offer: phoneOffer, confidence: 80 },
        { offer: budsOffer, confidence: 70 },
      ],
      'Samsung Наушники Galaxy Buds3 Pro Silver',
    );

    expect(result.needsManualPick).toBe(true);
    expect(result.searchCandidates?.every((c) => !/iphone/i.test(c.title))).toBe(true);
    expect(result.searchCandidates?.some((c) => /buds/i.test(c.title))).toBe(true);
  });

  it('only cross-category ranked → not_found', () => {
    const phoneOffer: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Смартфон Apple iPhone 17 Pro',
      price: 113_813,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/iphone-1/',
      found: true,
    };
    const result = buildOfferFromRankedCandidates(
      'ozon',
      'Galaxy Buds3 Pro',
      'https://www.ozon.ru/search/?text=buds',
      [{ offer: phoneOffer, confidence: 90 }],
      'Samsung Наушники Galaxy Buds3 Pro',
    );
    expect(result.matchStatus).toBe('not_found');
    expect(result.needsManualPick).toBeFalsy();
  });
});
