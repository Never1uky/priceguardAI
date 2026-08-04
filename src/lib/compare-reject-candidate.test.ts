import { describe, expect, it } from 'vitest';
import { applyRejectCompareCandidate } from '@/lib/compare-reject';
import { getRejectedUrls } from '@/lib/candidate-pool';
import { isUrlExcluded, pickTopMatchesWithScore } from '@/lib/product-match';
import type { CompareProduct } from '@/types/comparison';

function needsChoiceProduct(): CompareProduct {
  return {
    id: 'cam1',
    title: 'Фотоаппарат Nikon D5100 kit 18-105mm',
    sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
    sourceMarketplace: 'wildberries',
    marketplaceUrls: {},
    marketplaceOffers: {
      ozon: {
        marketplace: 'ozon',
        title: 'Выберите товар',
        price: null,
        delivery: null,
        rating: null,
        url: 'https://www.ozon.ru/search/?text=nikon',
        found: false,
        needsManualPick: true,
        matchStatus: 'needs_choice',
        searchCandidates: [
          {
            title: 'Аккумулятор EN-EL14 для Nikon D5100',
            url: 'https://www.ozon.ru/product/battery-1',
            price: 884,
            matchConfidence: 40,
          },
          {
            title: 'Сумка POLO для Nikon D7100',
            url: 'https://www.ozon.ru/product/bag-2',
            price: 15_815,
            matchConfidence: 35,
          },
          {
            title: 'Фотоаппарат Nikon D5100 body',
            url: 'https://www.ozon.ru/product/camera-3',
            price: 28_000,
            matchConfidence: 90,
          },
        ],
      },
    },
    candidatePoolByMarketplace: {
      ozon: [
        {
          title: 'Аккумулятор EN-EL14 для Nikon D5100',
          url: 'https://www.ozon.ru/product/battery-1',
          price: 884,
          matchConfidence: 40,
        },
        {
          title: 'Сумка POLO для Nikon D7100',
          url: 'https://www.ozon.ru/product/bag-2',
          price: 15_815,
          matchConfidence: 35,
        },
        {
          title: 'Фотоаппарат Nikon D5100 body',
          url: 'https://www.ozon.ru/product/camera-3',
          price: 28_000,
          matchConfidence: 90,
        },
      ],
    },
    addedAt: Date.now(),
  };
}

describe('applyRejectCompareCandidate', () => {
  it('rejects one of three → keeps needs_choice with 2 candidates', () => {
    const product = needsChoiceProduct();
    const { product: next, offer } = applyRejectCompareCandidate(
      product,
      'ozon',
      'https://www.ozon.ru/product/battery-1',
    );

    expect(getRejectedUrls(next, 'ozon').some((u) => u.includes('battery-1'))).toBe(true);
    expect(offer.matchStatus).toBe('needs_choice');
    expect(offer.needsManualPick).toBe(true);
    expect(offer.searchCandidates).toHaveLength(2);
    expect(offer.searchCandidates!.every((c) => !c.url.includes('battery-1'))).toBe(true);
  });

  it('rejects all candidates → not_found with empty picker', () => {
    let product = needsChoiceProduct();
    for (const url of [
      'https://www.ozon.ru/product/battery-1',
      'https://www.ozon.ru/product/bag-2',
      'https://www.ozon.ru/product/camera-3',
    ]) {
      const result = applyRejectCompareCandidate(product, 'ozon', url);
      product = result.product;
    }

    const offer = product.marketplaceOffers!.ozon!;
    expect(offer.matchStatus).toBe('not_found');
    expect(offer.needsManualPick).toBe(false);
    expect(offer.searchCandidates).toBeUndefined();
    expect(getRejectedUrls(product, 'ozon')).toHaveLength(3);
  });

  it('excludedUrls from rejectedOfferUrls filter pickTopMatchesWithScore', () => {
    const product = needsChoiceProduct();
    const { product: next } = applyRejectCompareCandidate(
      product,
      'ozon',
      'https://www.ozon.ru/product/battery-1',
    );
    const excluded = getRejectedUrls(next, 'ozon');

    const candidates = [
      { title: 'Аккумулятор EN-EL14', url: 'https://www.ozon.ru/product/battery-1' },
      { title: 'Фотоаппарат Nikon D5100 body', url: 'https://www.ozon.ru/product/camera-3' },
      { title: 'Nikon D5100 kit', url: 'https://www.ozon.ru/product/camera-4' },
    ];

    const top = pickTopMatchesWithScore(
      'Фотоаппарат Nikon D5100 kit 18-105mm',
      candidates,
      (c) => c.title,
      { getUrl: (c) => c.url, excludedUrls: excluded, limit: 3, minScore: 0.1 },
    );

    expect(top.every((t) => !isUrlExcluded(t.item.url, excluded))).toBe(true);
    expect(top.some((t) => t.item.url.includes('battery-1'))).toBe(false);
  });

  it('rejectedOfferUrls persist on product object (storage round-trip shape)', () => {
    const { product } = applyRejectCompareCandidate(
      needsChoiceProduct(),
      'ozon',
      'https://www.ozon.ru/product/battery-1',
    );
    const serialized = JSON.parse(JSON.stringify(product)) as CompareProduct;
    expect(serialized.rejectedOfferUrls?.ozon?.some((u) => u.includes('battery-1'))).toBe(true);
  });
});
