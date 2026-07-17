import { describe, expect, it } from 'vitest';
import {
  markOfferRejectedKeepPool,
  pickNextPoolCandidate,
  getCandidatePool,
  getRejectedUrls,
} from '@/lib/candidate-pool';
import type { CompareProduct } from '@/types/comparison';

function baseProduct(overrides: Partial<CompareProduct> = {}): CompareProduct {
  return {
    id: 'p1',
    title: 'Realme 16 5G 8/256',
    sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
    sourceMarketplace: 'wildberries',
    marketplaceUrls: {
      ozon: 'https://www.ozon.ru/product/xiaomi-111',
    },
    marketplaceOffers: {
      ozon: {
        marketplace: 'ozon',
        title: 'Xiaomi Redmi 15',
        price: 15_990,
        delivery: null,
        rating: null,
        url: 'https://www.ozon.ru/product/xiaomi-111',
        found: true,
        searchCandidates: [
          {
            title: 'Смартфон Realme 16 5G 8/256',
            url: 'https://www.ozon.ru/product/realme-222',
            price: 25_000,
            matchConfidence: 88,
            priority: 90,
          },
          {
            title: 'Xiaomi Redmi 15',
            url: 'https://www.ozon.ru/product/xiaomi-111',
            price: 15_990,
            matchConfidence: 40,
            priority: 40,
          },
        ],
      },
    },
    candidatePoolByMarketplace: {
      ozon: [
        {
          title: 'Смартфон Realme 16 5G 8/256',
          url: 'https://www.ozon.ru/product/realme-222',
          price: 25_000,
          matchConfidence: 88,
          priority: 90,
        },
        {
          title: 'Xiaomi Redmi 15',
          url: 'https://www.ozon.ru/product/xiaomi-111',
          price: 15_990,
          matchConfidence: 40,
          priority: 40,
        },
      ],
    },
    addedAt: Date.now(),
    ...overrides,
  };
}

describe('candidate pool / reject', () => {
  it('keeps pool after reject and picks next Realme candidate', () => {
    const product = baseProduct();
    const updated = markOfferRejectedKeepPool(
      product,
      'ozon',
      'https://www.ozon.ru/product/xiaomi-111',
      { bumpSearchVariant: false },
    );

    expect(getRejectedUrls(updated, 'ozon').some((u) => u.includes('xiaomi-111'))).toBe(true);

    expect(getCandidatePool(updated, 'ozon').some((c) => c.url.includes('realme-222'))).toBe(true);
    expect(updated.marketplaceUrls.ozon).toBeUndefined();

    const next = pickNextPoolCandidate(
      updated,
      'ozon',
      'https://www.ozon.ru/product/xiaomi-111',
    );
    expect(next?.url).toContain('realme-222');
  });

  it('bumps search variant only when requested', () => {
    const product = baseProduct();
    const noBump = markOfferRejectedKeepPool(product, 'ozon', 'https://www.ozon.ru/product/xiaomi-111');
    expect(noBump.searchVariantByMarketplace?.ozon).toBeUndefined();

    const bumped = markOfferRejectedKeepPool(
      product,
      'ozon',
      'https://www.ozon.ru/product/xiaomi-111',
      { bumpSearchVariant: true },
    );
    expect(bumped.searchVariantByMarketplace?.ozon).toBe(1);
  });
});
