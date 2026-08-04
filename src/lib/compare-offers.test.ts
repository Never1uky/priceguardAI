import { describe, expect, it } from 'vitest';
import {
  mergeMarketplaceOffers,
  mergeOfferRating,
  normalizeMarketplaceRating,
  offersFromCompareProduct,
  applyOffersToCompareProduct,
  finalizeResearchOffer,
  settleCompareProductLoading,
  isUsefulOffer,
  parseRatingFromMarketplaceText,
  preferRicherMarketplaceOffer,
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

describe('normalizeMarketplaceRating', () => {
  it('parses comma and «из 5»', () => {
    expect(normalizeMarketplaceRating('4,8')).toBe(4.8);
    expect(normalizeMarketplaceRating('4.5 из 5')).toBe(4.5);
    expect(normalizeMarketplaceRating(4.92)).toBe(4.9);
    expect(normalizeMarketplaceRating(14.2)).toBeNull();
  });
});

describe('mergeOfferRating', () => {
  it('keeps prev when next is null', () => {
    expect(mergeOfferRating(4.7, null)).toBe(4.7);
    expect(mergeOfferRating(4.7, undefined)).toBe(4.7);
  });

  it('prefers valid next', () => {
    expect(mergeOfferRating(4.7, 4.9)).toBe(4.9);
  });
});

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

  it('SERP rating survives price refresh without rating', () => {
    const withSerpRating: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Наушники',
      price: 9990,
      delivery: null,
      rating: 4.8,
      reviewCount: 120,
      url: 'https://www.ozon.ru/product/headphones-1/',
      found: true,
    };

    const priceOnlyRefresh: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Наушники',
      price: 9490,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/headphones-1/',
      found: true,
    };

    const merged = mergeMarketplaceOffers(withSerpRating, priceOnlyRefresh);
    expect(merged.price).toBe(9490);
    expect(merged.rating).toBe(4.8);
    expect(merged.reviewCount).toBe(120);
  });

  it('keeps SERP rating on shell when card cascade returns price without rating', () => {
    const serpShell: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Наушники',
      price: null,
      delivery: null,
      rating: 4.6,
      url: 'https://www.ozon.ru/product/headphones-1/',
      found: false,
      needsManualPick: true,
      searchCandidates: [
        {
          title: 'Наушники',
          url: 'https://www.ozon.ru/product/headphones-1/',
          price: 9990,
          matchConfidence: 96,
          rating: 4.6,
        },
      ],
    };

    const cardNoRating: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Наушники Pro',
      price: 9990,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/headphones-1/',
      found: true,
      needsManualPick: false,
    };

    const merged = mergeMarketplaceOffers(serpShell, cardNoRating);
    expect(merged.rating).toBe(4.6);
    expect(merged.price).toBe(9990);
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

  it('empty non-priced slots get not_found + error for «Найти на …» CTA', () => {
    const product: CompareProduct = {
      ...wbSource,
      marketplaceOffers: {
        wildberries: wbSource.sourceOffer!,
      },
    };

    const offers = offersFromCompareProduct(product);
    const ym = offers.find((o) => o.marketplace === 'yandex_market');
    const ozon = offers.find((o) => o.marketplace === 'ozon');

    expect(ym?.matchStatus).toBe('not_found');
    expect(ym?.error).toBeTruthy();
    expect(ym?.found).toBe(false);
    expect(ozon?.matchStatus).toBe('not_found');
    expect(ozon?.error).toBeTruthy();
  });
});

describe('parseRatingFromMarketplaceText', () => {
  it('reads rating and review count from tile text', () => {
    const parsed = parseRatingFromMarketplaceText('Наушники 4,9 ★ 1 234 отзыва 9 990 ₽');
    expect(parsed.rating).toBe(4.9);
    expect(parsed.reviewCount).toBe(1234);
  });
});

describe('finalizeResearchOffer empty → not_found', () => {
  it('converts empty price slot to not_found with error', () => {
    const empty: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Cudy AP3000',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/search/?text=Cudy%20AP3000',
      found: false,
    };

    const finalized = finalizeResearchOffer(empty);
    expect(finalized.matchStatus).toBe('not_found');
    expect(finalized.found).toBe(false);
    expect(finalized.price).toBeNull();
    expect(finalized.error).toBeTruthy();
  });

  it('finalizes leftover loading_card to not_found', () => {
    const loading: MarketplaceOffer = {
      marketplace: 'yandex_market',
      title: 'Товар',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://market.yandex.ru/search?text=x',
      found: false,
      matchStatus: 'loading_card',
    };
    const finalized = finalizeResearchOffer(loading);
    expect(finalized.matchStatus).toBe('not_found');
    expect(finalized.error).toBeTruthy();
  });

  it('settleCompareProductLoading clears stuck loading slots', () => {
    const product: CompareProduct = {
      ...wbSource,
      marketplaceOffers: {
        ...wbSource.marketplaceOffers,
        yandex_market: {
          marketplace: 'yandex_market',
          title: 'Товар',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://market.yandex.ru/search?text=x',
          found: false,
          matchStatus: 'loading_card',
        },
      },
    };
    const settled = settleCompareProductLoading(product);
    expect(settled.marketplaceOffers?.yandex_market?.matchStatus).toBe('not_found');
  });

  it('keeps needs_choice with candidate pool', () => {
    const choice: MarketplaceOffer = {
      marketplace: 'yandex_market',
      title: 'Cudy',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://market.yandex.ru/product/1',
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
      searchCandidates: [
        {
          title: 'Cudy AP3000',
          url: 'https://market.yandex.ru/product/1',
          price: 5990,
          matchConfidence: 88,
        },
      ],
    };

    const finalized = finalizeResearchOffer(choice);
    expect(finalized.matchStatus).toBe('needs_choice');
    expect(finalized.needsManualPick).toBe(true);
    expect(finalized.searchCandidates).toHaveLength(1);
  });

  it('applyOffers persists empty→not_found over loading_card (no silent Нет цены)', () => {
    const product: CompareProduct = {
      ...wbSource,
      marketplaceOffers: {
        ...wbSource.marketplaceOffers,
        ozon: {
          marketplace: 'ozon',
          title: 'Cudy AP3000',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://www.ozon.ru/search/?text=Cudy',
          found: false,
          matchStatus: 'loading_card',
        },
      },
    };

    const emptyFinal: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Cudy AP3000',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/search/?text=Cudy',
      found: false,
    };

    const next = applyOffersToCompareProduct(product, [finalizeResearchOffer(emptyFinal)]);
    const ozon = next.marketplaceOffers?.ozon;
    expect(ozon?.matchStatus).toBe('not_found');
    expect(ozon?.error).toBeTruthy();
    expect(ozon?.price).toBeNull();

    const fromProduct = offersFromCompareProduct(next).find((o) => o.marketplace === 'ozon');
    expect(fromProduct?.matchStatus).toBe('not_found');
    expect(fromProduct?.error).toBeTruthy();
  });

  it('merge does not keep stale price when incoming is not_found', () => {
    const base: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Wrong',
      price: 999,
      delivery: null,
      rating: 4.5,
      url: 'https://www.ozon.ru/product/wrong-1/',
      found: true,
      matchStatus: 'verified',
    };
    const incoming = finalizeResearchOffer({
      marketplace: 'ozon',
      title: 'Cudy AP3000',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/search/?text=Cudy',
      found: false,
    });
    const merged = mergeMarketplaceOffers(base, incoming);
    expect(merged.price).toBeNull();
    expect(merged.found).toBe(false);
    expect(merged.matchStatus).toBe('not_found');
  });

  it('does not wipe needs_choice candidates with empty not_found (stale sync)', () => {
    const pending: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'SONY WH-1000XM5',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/search/?text=sony',
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
      error: 'Цены сильно отличаются — выберите нужный из 2',
      searchCandidates: [
        {
          title: 'Самый дешевый',
          url: 'https://www.ozon.ru/product/cheap-1/',
          price: 22_999,
          matchConfidence: 70,
        },
        {
          title: 'Sony WH-1000XM5',
          url: 'https://www.ozon.ru/product/sony-2/',
          price: 31_000,
          matchConfidence: 92,
        },
      ],
    };
    const staleNotFound: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'SONY WH-1000XM5',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/search/?text=sony',
      found: false,
      matchStatus: 'not_found',
      error: 'Товар не найден — добавьте прямую ссылку на карточку',
    };
    const merged = mergeMarketplaceOffers(pending, staleNotFound);
    expect(merged.matchStatus).toBe('needs_choice');
    expect(merged.needsManualPick).toBe(true);
    expect(merged.searchCandidates).toHaveLength(2);
    expect(merged.searchCandidates?.[1]?.url).toContain('sony-2');

    const viaPrefer = preferRicherMarketplaceOffer(pending, staleNotFound);
    expect(viaPrefer.matchStatus).toBe('needs_choice');
    expect(viaPrefer.searchCandidates).toHaveLength(2);
  });

  it('preferRicher: more candidates wins between two pending choices', () => {
    const two: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'A',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/search/?text=a',
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
      searchCandidates: [
        { title: '1', url: 'https://www.ozon.ru/product/1/', price: 1, matchConfidence: 80 },
        { title: '2', url: 'https://www.ozon.ru/product/2/', price: 2, matchConfidence: 70 },
      ],
    };
    const one: MarketplaceOffer = {
      ...two,
      searchCandidates: [
        { title: '1', url: 'https://www.ozon.ru/product/1/', price: 1, matchConfidence: 80 },
      ],
    };
    expect(preferRicherMarketplaceOffer(two, one).searchCandidates).toHaveLength(2);
    expect(preferRicherMarketplaceOffer(one, two).searchCandidates).toHaveLength(2);
  });

  it('finalizeResearchOffer keeps needs_choice when matchStatus set without flag', () => {
    const offer = finalizeResearchOffer({
      marketplace: 'ozon',
      title: 'X',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/search/?text=x',
      found: false,
      matchStatus: 'needs_choice',
      searchCandidates: [
        {
          title: 'A',
          url: 'https://www.ozon.ru/product/a/',
          price: 100,
          matchConfidence: 80,
        },
      ],
    });
    expect(offer.matchStatus).toBe('needs_choice');
    expect(offer.needsManualPick).toBe(true);
  });

  it('clears marketplaceUrls when applying terminal OOS', () => {
    const product: CompareProduct = {
      ...wbSource,
      marketplaceUrls: {
        wildberries: wbSource.sourceUrl,
        ozon: 'https://www.ozon.ru/product/haier-oos/',
      },
      marketplaceOffers: {
        ozon: {
          marketplace: 'ozon',
          title: 'Haier',
          price: 52000,
          delivery: null,
          rating: null,
          url: 'https://www.ozon.ru/product/haier-oos/',
          found: true,
          matchStatus: 'verified',
        },
      },
    };

    const next = applyOffersToCompareProduct(product, [
      finalizeResearchOffer({
        marketplace: 'ozon',
        title: 'Haier',
        price: null,
        delivery: null,
        rating: null,
        url: 'https://www.ozon.ru/product/haier-oos/',
        found: false,
        error: 'Нет в наличии',
        matchStatus: 'oos',
      }),
    ]);

    expect(next.marketplaceUrls?.ozon).toBeUndefined();
    expect(next.marketplaceOffers?.ozon?.matchStatus).toBe('oos');
    expect(next.marketplaceOffers?.ozon?.price).toBeNull();
    expect(next.marketplaceOffers?.ozon?.url).toBe('');
  });

  it('finalizeResearchOffer clears product-page URL on OOS and not_found', () => {
    const oos = finalizeResearchOffer({
      marketplace: 'ozon',
      title: 'Haier',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/haier-oos/',
      found: false,
      error: 'Нет в наличии',
    });
    expect(oos.matchStatus).toBe('oos');
    expect(oos.url).toBe('');

    const missing = finalizeResearchOffer({
      marketplace: 'ozon',
      title: 'Gone',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/moved/',
      found: false,
      error: 'Товар не найден',
    });
    expect(missing.matchStatus).toBe('not_found');
    expect(missing.url).toBe('');

    const searchKept = finalizeResearchOffer({
      marketplace: 'ozon',
      title: 'Query',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/search/?text=haier',
      found: false,
      error: 'Товар не найден',
    });
    expect(searchKept.url).toContain('/search/');
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
