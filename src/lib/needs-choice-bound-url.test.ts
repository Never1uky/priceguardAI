import { describe, expect, it } from 'vitest';
import { getStoredProductPageUrl } from '@/lib/marketplace-search';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import type { CompareProduct } from '@/types/comparison';

describe('getStoredProductPageUrl vs needs_choice', () => {
  const base: CompareProduct = {
    id: 'p1',
    title: 'SONY WH-1000XM5',
    sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
    sourceMarketplace: 'wildberries',
    marketplaceUrls: {
      wildberries: 'https://www.wildberries.ru/catalog/1/detail.aspx',
    },
    addedAt: Date.now(),
  };

  it('ignores candidate product URL on needs_choice offer', () => {
    const product: CompareProduct = {
      ...base,
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'Sony',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://www.ozon.ru/product/cheap-candidate/',
          found: false,
          needsManualPick: true,
          matchStatus: 'needs_choice',
          searchCandidates: [
            {
              title: 'Cheap',
              url: 'https://www.ozon.ru/product/cheap-candidate/',
              price: 22999,
              matchConfidence: 70,
            },
          ],
        },
      },
    };

    expect(getStoredProductPageUrl(product, 'ozon')).toBeUndefined();
  });

  it('ignores marketplaceUrls while needs_choice unless manual', () => {
    const product: CompareProduct = {
      ...base,
      marketplaceUrls: {
        ...base.marketplaceUrls,
        ozon: 'https://www.ozon.ru/product/bound-manual/',
      },
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'Sony',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://www.ozon.ru/search/?text=sony',
          found: false,
          needsManualPick: true,
          matchStatus: 'needs_choice',
          searchCandidates: [
            {
              title: 'Cheap',
              url: 'https://www.ozon.ru/product/cheap-candidate/',
              price: 22999,
              matchConfidence: 70,
            },
          ],
        },
      },
    };

    expect(getStoredProductPageUrl(product, 'ozon')).toBeUndefined();
  });

  it('manual marketplaceUrls still bind during needs_choice', () => {
    const product: CompareProduct = {
      ...base,
      manualMarketplaces: { ozon: true },
      marketplaceUrls: {
        ...base.marketplaceUrls,
        ozon: 'https://www.ozon.ru/product/bound-manual/',
      },
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'Sony',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://www.ozon.ru/search/?text=sony',
          found: false,
          needsManualPick: true,
          matchStatus: 'needs_choice',
          searchCandidates: [
            {
              title: 'Cheap',
              url: 'https://www.ozon.ru/product/cheap-candidate/',
              price: 22999,
              matchConfidence: 70,
            },
          ],
        },
      },
    };

    expect(getStoredProductPageUrl(product, 'ozon')).toMatch(/bound-manual/);
  });

  it('returns verified offer product URL', () => {
    const product: CompareProduct = {
      ...base,
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'Sony',
          price: 31000,
          delivery: null,
          rating: 4.8,
          url: 'https://www.ozon.ru/product/verified/',
          found: true,
          matchStatus: 'verified',
        },
      },
    };

    expect(getStoredProductPageUrl(product, 'ozon')).toBe(
      'https://www.ozon.ru/product/verified/',
    );
  });

  it('ignores dead product URL when offer is oos / not_found / blocked', () => {
    const dead = 'https://www.ozon.ru/product/dead-card/';
    for (const matchStatus of ['oos', 'not_found', 'blocked'] as const) {
      const product: CompareProduct = {
        ...base,
        marketplaceUrls: {
          ...base.marketplaceUrls,
          ozon: dead,
        },
        marketplaceOffers: {
          ozon: {
            marketplace: 'ozon',
            title: 'Haier',
            price: null,
            delivery: null,
            rating: null,
            url: dead,
            found: false,
            matchStatus,
            error: matchStatus === 'oos' ? 'Нет в наличии' : 'Товар не найден',
          },
        },
      };
      expect(getStoredProductPageUrl(product, 'ozon')).toBeUndefined();
    }
  });

  it('manual link still binds when offer is oos', () => {
    const product: CompareProduct = {
      ...base,
      manualMarketplaces: { ozon: true },
      marketplaceUrls: {
        ...base.marketplaceUrls,
        ozon: 'https://www.ozon.ru/product/manual-oos/',
      },
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'Manual',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://www.ozon.ru/product/manual-oos/',
          found: false,
          matchStatus: 'oos',
          error: 'Нет в наличии',
        },
      },
    };
    expect(getStoredProductPageUrl(product, 'ozon')).toMatch(/manual-oos/);
  });
});

describe('needs_choice shell url is search page', () => {
  const searchUrl = 'https://www.ozon.ru/search/?text=sony+wh';

  it('buildOfferFromRankedCandidates uses searchUrl not candidate card', () => {
    const result = buildOfferFromRankedCandidates('ozon', 'sony wh', searchUrl, [
      {
        confidence: 80,
        offer: {
          marketplace: 'ozon',
          title: 'Cheap fake',
          url: 'https://www.ozon.ru/product/cheap/',
          price: 22999,
          delivery: null,
          rating: null,
          found: false,
        },
      },
      {
        confidence: 92,
        offer: {
          marketplace: 'ozon',
          title: 'Sony WH-1000XM5',
          url: 'https://www.ozon.ru/product/sony/',
          price: 31000,
          delivery: null,
          rating: null,
          found: false,
        },
      },
    ]);

    expect(result.needsManualPick).toBe(true);
    expect(result.url).toBe(searchUrl);
    expect(result.url).not.toContain('/product/');
    expect(result.searchCandidates?.length).toBeGreaterThanOrEqual(2);
  });
});
