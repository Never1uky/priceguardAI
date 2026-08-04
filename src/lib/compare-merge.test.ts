import { describe, expect, it } from 'vitest';
import {
  areCompareProductsCompatibleForMerge,
  findDuplicateCompareProduct,
  mergeCompareProducts,
  mergeDuplicateCompareList,
} from '@/lib/compare-merge';
import type { CompareProduct } from '@/types/comparison';

function base(partial: Partial<CompareProduct> & Pick<CompareProduct, 'id' | 'sourceMarketplace' | 'sourceUrl'>): CompareProduct {
  return {
    title: partial.title ?? 'Товар',
    addedAt: partial.addedAt ?? Date.now(),
    marketplaceUrls: partial.marketplaceUrls ?? {},
    marketplaceOffers: partial.marketplaceOffers ?? {},
    ...partial,
  };
}

describe('findDuplicateCompareProduct cross-MP', () => {
  it('merges when same marketplace-scoped article (YM key already on WB row)', () => {
    const existing = base({
      id: 'wb-iphone',
      title: 'iPhone 17 Pro Max 256Gb',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/5129523330/detail.aspx',
      article: '5129523330',
      marketplaceUrls: {
        wildberries: 'https://www.wildberries.ru/catalog/5129523330/detail.aspx',
        yandex_market: 'https://market.yandex.ru/product/123',
      },
      articlesByMarketplace: {
        wildberries: '5129523330',
        yandex_market: '5129523330',
      },
    });

    const incoming = base({
      id: 'ym-iphone',
      title: 'Смартфон Apple iPhone 17 Pro Max 256Gb',
      sourceMarketplace: 'yandex_market',
      sourceUrl: 'https://market.yandex.ru/product/999',
      article: '5129523330',
      marketplaceUrls: {
        yandex_market: 'https://market.yandex.ru/product/999',
      },
    });

    expect(findDuplicateCompareProduct([existing], incoming)?.id).toBe('wb-iphone');
  });

  it('does not merge same numeric article on different marketplaces', () => {
    const wb = base({
      id: 'wb-cam',
      title: 'Фотоаппарат NIKON D5300',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/2599/detail.aspx',
      article: '2599',
      marketplaceUrls: {
        wildberries: 'https://www.wildberries.ru/catalog/2599/detail.aspx',
      },
      articlesByMarketplace: { wildberries: '2599' },
    });
    const ozon = base({
      id: 'ozon-brush',
      title: 'Oral-B Vitality Pro Электрическая зубная щетка',
      sourceMarketplace: 'ozon',
      sourceUrl: 'https://www.ozon.ru/product/oral-b-2599/',
      article: '2599',
      marketplaceUrls: {
        ozon: 'https://www.ozon.ru/product/oral-b-2599/',
      },
      articlesByMarketplace: { ozon: '2599' },
    });

    expect(findDuplicateCompareProduct([wb], ozon)).toBeNull();
    expect(mergeDuplicateCompareList([wb, ozon])).toHaveLength(2);
  });

  it('does not merge Nikon camera with Oral-B toothbrush', () => {
    const nikon = base({
      id: 'nikon',
      title: 'Фотоаппарат NIKON D5300 Kit',
      sourceMarketplace: 'yandex_market',
      sourceUrl: 'https://market.yandex.ru/product/nikon-d5300',
      article: '111',
    });
    const oral = base({
      id: 'oral',
      title: 'Oral-B Vitality Pro Электрическая зубная щетка',
      sourceMarketplace: 'ozon',
      sourceUrl: 'https://www.ozon.ru/product/oral-b-vitality/',
      article: '222',
    });

    expect(areCompareProductsCompatibleForMerge(nikon, oral)).toBe(false);
    expect(findDuplicateCompareProduct([nikon], oral)).toBeNull();
  });

  it('does not merge incompatible brands even when URL overlaps', () => {
    const shared = 'https://www.ozon.ru/product/wrong-bind-1/';
    const nikon = base({
      id: 'nikon',
      title: 'Фотоаппарат NIKON D5300',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'Oral-B Vitality Pro',
          price: 2599,
          delivery: null,
          rating: null,
          url: shared,
          found: true,
        },
      },
    });
    const oral = base({
      id: 'oral',
      title: 'Oral-B Vitality Pro Электрическая зубная щетка',
      sourceMarketplace: 'ozon',
      sourceUrl: shared,
    });

    expect(findDuplicateCompareProduct([nikon], oral)).toBeNull();
  });

  it('merges when offer URL overlaps and brands compatible', () => {
    const ozonUrl = 'https://www.ozon.ru/product/iphone-17-111/';
    const existing = base({
      id: 'a',
      title: 'Apple iPhone 17 Pro',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'Apple iPhone 17 Pro',
          price: 100000,
          delivery: null,
          rating: null,
          url: ozonUrl,
          found: true,
        },
      },
    });

    const incoming = base({
      id: 'b',
      title: 'Смартфон Apple iPhone 17 Pro 256GB',
      sourceMarketplace: 'ozon',
      sourceUrl: ozonUrl,
    });

    expect(findDuplicateCompareProduct([existing], incoming)?.id).toBe('a');
  });

  it('does not merge different products without shared URL/article', () => {
    const a = base({
      id: 'a',
      title: 'POCO M8 Pro',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/111/detail.aspx',
      article: '111',
    });
    const b = base({
      id: 'b',
      title: 'Redmi 15',
      sourceMarketplace: 'ozon',
      sourceUrl: 'https://www.ozon.ru/product/redmi-15-222/',
      article: '222',
    });
    expect(findDuplicateCompareProduct([a], b)).toBeNull();
  });
});

describe('mergeDuplicateCompareList', () => {
  it('collapses rows that share a marketplace-scoped article key', () => {
    const wb = base({
      id: 'wb',
      title: 'iPhone 17 Pro Max',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/5129523330/detail.aspx',
      article: '5129523330',
      marketplaceUrls: {
        wildberries: 'https://www.wildberries.ru/catalog/5129523330/detail.aspx',
        ozon: 'https://www.ozon.ru/product/iphone-1/',
      },
      articlesByMarketplace: {
        wildberries: '5129523330',
        yandex_market: '5129523330',
      },
    });
    const ym = base({
      id: 'ym',
      title: 'iPhone 17 Pro Max Silver',
      sourceMarketplace: 'yandex_market',
      sourceUrl: 'https://market.yandex.ru/product/only-ym',
      article: '5129523330',
      marketplaceUrls: {
        yandex_market: 'https://market.yandex.ru/product/only-ym',
      },
    });

    const merged = mergeDuplicateCompareList([wb, ym]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe('wb');
    expect(merged[0]!.marketplaceUrls.yandex_market).toContain('market.yandex');
    expect(mergeCompareProducts(wb, ym).article).toBe('5129523330');
  });

  it('keeps separate rows when only bare numeric article matches across MPs', () => {
    const wb = base({
      id: 'wb',
      title: 'Фотоаппарат NIKON D5300',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/999/detail.aspx',
      article: '999',
    });
    const ym = base({
      id: 'ym',
      title: 'Oral-B Vitality Pro Электрическая зубная щетка',
      sourceMarketplace: 'yandex_market',
      sourceUrl: 'https://market.yandex.ru/product/oral-999',
      article: '999',
    });

    expect(mergeDuplicateCompareList([wb, ym])).toHaveLength(2);
  });
});

describe('mergeCompareProducts needs_choice persistence', () => {
  it('keeps local needs_choice when remote is empty not_found', () => {
    const local = base({
      id: 'wb-sony',
      title: 'SONY Наушники WH-1000XM5',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      comparedAt: 2000,
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'SONY WH-1000XM5',
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
              url: 'https://www.ozon.ru/product/cheap/',
              price: 22_999,
              matchConfidence: 70,
            },
            {
              title: 'Sony',
              url: 'https://www.ozon.ru/product/sony/',
              price: 31_000,
              matchConfidence: 90,
            },
          ],
        },
      },
    });
    const remote = base({
      id: 'wb-sony',
      title: 'SONY Наушники WH-1000XM5',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      comparedAt: 1000,
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'SONY WH-1000XM5',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://www.ozon.ru/search/?text=sony',
          found: false,
          matchStatus: 'not_found',
          error: 'Товар не найден — добавьте прямую ссылку на карточку',
        },
      },
    });

    const merged = mergeCompareProducts(local, remote);
    expect(merged.marketplaceOffers?.ozon?.matchStatus).toBe('needs_choice');
    expect(merged.marketplaceOffers?.ozon?.searchCandidates).toHaveLength(2);
    expect(merged.comparedAt).toBe(2000);
    expect(merged.marketplaceUrls?.ozon).toBeUndefined();
  });

  it('strips polluted ozon marketplaceUrls when keeping needs_choice', () => {
    const local = base({
      id: 'wb-sony',
      title: 'SONY Наушники WH-1000XM5',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      comparedAt: 2000,
      marketplaceUrls: {
        wildberries: 'https://www.wildberries.ru/catalog/1/detail.aspx',
        ozon: 'https://www.ozon.ru/product/stale-candidate/',
      },
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'SONY WH-1000XM5',
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
              url: 'https://www.ozon.ru/product/cheap/',
              price: 22_999,
              matchConfidence: 70,
            },
            {
              title: 'Sony',
              url: 'https://www.ozon.ru/product/sony/',
              price: 31_000,
              matchConfidence: 90,
            },
          ],
        },
      },
    });
    const remote = base({
      id: 'wb-sony',
      title: 'SONY Наушники WH-1000XM5',
      sourceMarketplace: 'wildberries',
      sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      comparedAt: 1000,
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'SONY WH-1000XM5',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://www.ozon.ru/search/?text=sony',
          found: false,
          matchStatus: 'not_found',
        },
      },
    });

    const merged = mergeCompareProducts(local, remote);
    expect(merged.marketplaceOffers?.ozon?.matchStatus).toBe('needs_choice');
    expect(merged.marketplaceUrls?.ozon).toBeUndefined();
  });
});
