import { describe, expect, it } from 'vitest';
import {
  markOfferRejectedKeepPool,
  pickNextPoolCandidate,
  getCandidatePool,
  getRejectedUrls,
  clearAllBoundTargets,
  researchClearAutoOnly,
  clearBoundOffer,
  findPendingChoiceForProductUrl,
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

  it('clearAllBoundTargets clears pool and searchCandidates for research', () => {
    const product = baseProduct();
    expect(getCandidatePool(product, 'ozon').length).toBeGreaterThan(0);

    const cleared = clearAllBoundTargets(product);
    expect(cleared.marketplaceUrls?.ozon).toBeUndefined();
    expect(getCandidatePool(cleared, 'ozon')).toEqual([]);
    expect(cleared.marketplaceOffers?.ozon?.searchCandidates).toBeUndefined();
    expect(cleared.candidatePoolByMarketplace?.ozon).toBeUndefined();
  });

  it('researchClearAutoOnly preserves manual marketplace slot', () => {
    const product = baseProduct({
      manualMarketplaces: { ozon: true },
    });
    const cleared = researchClearAutoOnly(product);
    expect(cleared.marketplaceUrls?.ozon).toBe(product.marketplaceUrls?.ozon);
    expect(cleared.manualMarketplaces?.ozon).toBe(true);
    expect(cleared.marketplaceOffers?.ozon?.price).toBe(15_990);
  });

  it('findPendingChoiceForProductUrl matches open needs_choice candidate', () => {
    const product = baseProduct({
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'Выберите товар',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://www.ozon.ru/search/?text=realme',
          found: false,
          needsManualPick: true,
          matchStatus: 'needs_choice',
          searchCandidates: [
            {
              title: 'Смартфон Realme 16 5G 8/256',
              url: 'https://www.ozon.ru/product/realme-222',
              price: 25_000,
              matchConfidence: 88,
            },
          ],
          error: 'Похожие варианты',
        },
      },
    });

    const hit = findPendingChoiceForProductUrl(
      [product],
      'https://www.ozon.ru/product/realme-222/?from=picker',
    );
    expect(hit?.product.id).toBe('p1');
    expect(hit?.marketplace).toBe('ozon');

    expect(
      findPendingChoiceForProductUrl([product], 'https://www.ozon.ru/product/unrelated-999'),
    ).toBeNull();
  });

  it('researchClearAutoOnly preservePendingChoice keeps needs_choice picker', () => {
    const product = baseProduct({
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'Выберите товар',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://www.ozon.ru/search/?text=realme',
          found: false,
          needsManualPick: true,
          matchStatus: 'needs_choice',
          searchCandidates: [
            {
              title: 'Смартфон Realme 16 5G 8/256',
              url: 'https://www.ozon.ru/product/realme-222',
              price: 25_000,
              matchConfidence: 88,
            },
          ],
          error: 'Похожие варианты',
        },
      },
    });

    const wiped = researchClearAutoOnly(product);
    expect(wiped.marketplaceOffers?.ozon?.needsManualPick).toBeFalsy();
    expect(wiped.marketplaceOffers?.ozon?.searchCandidates).toBeUndefined();

    const preserved = researchClearAutoOnly(product, { preservePendingChoice: true });
    expect(preserved.marketplaceOffers?.ozon?.needsManualPick).toBe(true);
    expect(preserved.marketplaceOffers?.ozon?.searchCandidates?.length).toBe(1);
    expect(preserved.marketplaceOffers?.ozon?.matchStatus).toBe('needs_choice');
  });

  it('clearBoundOffer on one marketplace leaves sibling offers intact', () => {
    const product = baseProduct({
      marketplaceUrls: {
        ozon: 'https://www.ozon.ru/product/xiaomi-111',
        yandex_market: 'https://market.yandex.ru/product/999',
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
          matchStatus: 'verified',
        },
        yandex_market: {
          marketplace: 'yandex_market',
          title: 'Not found',
          price: null,
          delivery: null,
          rating: null,
          url: '',
          found: false,
          matchStatus: 'not_found',
          error: 'лимит запросов',
        },
      },
    });

    const cleared = clearBoundOffer(product, 'yandex_market', { clearPool: true });
    expect(cleared.marketplaceUrls?.ozon).toBe('https://www.ozon.ru/product/xiaomi-111');
    expect(cleared.marketplaceOffers?.ozon?.price).toBe(15_990);
    expect(cleared.marketplaceOffers?.ozon?.found).toBe(true);
    expect(cleared.marketplaceUrls?.yandex_market).toBeUndefined();
    expect(cleared.marketplaceOffers?.yandex_market?.found).toBe(false);
    expect(cleared.marketplaceOffers?.yandex_market?.matchStatus).toBe('not_found');
  });
});
