import { describe, expect, it } from 'vitest';
import {
  mergeMarketplaceOffers,
  offersFromCompareProduct,
  isUsefulOffer,
} from '@/lib/compare-offers';
import { findDuplicateCompareProduct } from '@/lib/compare-merge';
import type { CompareProduct, MarketplaceOffer } from '@/types/comparison';

const wbSource: CompareProduct = {
  id: 'cmp1',
  title: 'Sony PlayStation 5 Slim 1TB',
  article: '111',
  sourceUrl: 'https://www.wildberries.ru/catalog/111/detail.aspx',
  sourceMarketplace: 'wildberries',
  marketplaceUrls: {
    wildberries: 'https://www.wildberries.ru/catalog/111/detail.aspx',
  },
  marketplaceOffers: {
    wildberries: {
      marketplace: 'wildberries',
      title: 'Sony PlayStation 5 Slim 1TB',
      price: 61249,
      delivery: null,
      rating: 4.9,
      url: 'https://www.wildberries.ru/catalog/111/detail.aspx',
      found: true,
      matchConfidence: 100,
    },
  },
  sourceOffer: {
    marketplace: 'wildberries',
    title: 'Sony PlayStation 5 Slim 1TB',
    price: 61249,
    delivery: null,
    rating: 4.9,
    url: 'https://www.wildberries.ru/catalog/111/detail.aspx',
    found: true,
    matchConfidence: 100,
  },
  addedAt: Date.now(),
};

describe('compare-offers merge', () => {
  it('clears stale needsManualPick when direct priced offer arrives', () => {
    const stale: MarketplaceOffer = {
      marketplace: 'wildberries',
      title: 'PS5',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.wildberries.ru/catalog/0/search.aspx?search=ps5',
      found: false,
      needsManualPick: true,
      searchCandidates: [
        {
          title: 'A',
          url: 'https://www.wildberries.ru/catalog/1/detail.aspx',
          price: 50000,
          matchConfidence: 95,
        },
      ],
    };

    const direct: MarketplaceOffer = {
      marketplace: 'wildberries',
      title: 'Sony PS5 Slim',
      price: 61249,
      delivery: null,
      rating: 4.9,
      url: 'https://www.wildberries.ru/catalog/111/detail.aspx',
      found: true,
      needsManualPick: false,
      matchConfidence: 100,
    };

    const merged = mergeMarketplaceOffers(stale, direct);
    expect(merged.needsManualPick).toBe(false);
    expect(merged.searchCandidates).toBeUndefined();
    expect(merged.price).toBe(61249);
  });

  it('keeps candidate-only offers visible in table', () => {
    const product: CompareProduct = {
      ...wbSource,
      marketplaceOffers: {
        yandex_market: {
          marketplace: 'yandex_market',
          title: 'PS5',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://market.yandex.ru/search?text=ps5',
          found: false,
          needsManualPick: true,
          searchCandidates: [
            {
              title: 'Sony PS5',
              url: 'https://market.yandex.ru/product/1',
              price: 50476,
              matchConfidence: 95,
            },
          ],
          error: 'Похожие варианты',
        },
      },
    };

    const offers = offersFromCompareProduct(product);
    const ym = offers.find((o) => o.marketplace === 'yandex_market');
    expect(ym?.needsManualPick).toBe(true);
    expect(ym?.searchCandidates?.length).toBe(1);
    expect(isUsefulOffer(ym)).toBe(true);
  });
});

describe('findDuplicateCompareProduct', () => {
  it('does not fuzzy-merge WB add into existing Ozon product', () => {
    const ozon: CompareProduct = {
      id: 'cmp-ozon',
      title: 'Игровая консоль Sony PlayStation 5 Slim 1TB',
      sourceUrl: 'https://www.ozon.ru/product/ps5-999/',
      sourceMarketplace: 'ozon',
      marketplaceUrls: { ozon: 'https://www.ozon.ru/product/ps5-999/' },
      addedAt: Date.now(),
    };

    expect(findDuplicateCompareProduct([ozon], wbSource)).toBeNull();
  });

  it('matches same WB URL as duplicate', () => {
    const other: CompareProduct = {
      ...wbSource,
      id: 'cmp2',
    };
    expect(findDuplicateCompareProduct([wbSource], other)?.id).toBe('cmp1');
  });
});
