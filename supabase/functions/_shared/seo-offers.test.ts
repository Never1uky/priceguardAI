import { describe, expect, it } from 'vitest';
import { mergeSeoOffers, SEO_MAX_OFFERS, type SeoOfferSnapshot } from './seo-publish-core.ts';
import { countPricedOffers } from './seo-refresh-offers-run.ts';

describe('mergeSeoOffers', () => {
  it('CASE 1: single marketplace offer', () => {
    const offers = mergeSeoOffers([
      {
        marketplace: 'ozon',
        productId: '111',
        url: 'https://www.ozon.ru/product/111',
        price: 4990,
      },
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0].marketplace).toBe('ozon');
  });

  it('CASE 2: same product on three marketplaces → three offers', () => {
    const offers = mergeSeoOffers([
      {
        marketplace: 'ozon',
        productId: '1',
        url: 'https://ozon.ru/1',
        price: 100,
      },
      {
        marketplace: 'wildberries',
        productId: '2',
        url: 'https://wb.ru/2',
        price: 110,
      },
      {
        marketplace: 'yandex_market',
        productId: '3',
        url: 'https://market.yandex.ru/3',
        price: 120,
      },
    ]);
    expect(offers).toHaveLength(3);
    expect(new Set(offers.map((o) => o.marketplace)).size).toBe(3);
  });

  it('CASE 3: two Ozon sellers (different productIds) stay as two offers', () => {
    const offers = mergeSeoOffers([
      {
        marketplace: 'ozon',
        productId: 'aaa',
        url: 'https://ozon.ru/aaa',
        price: 100,
      },
      {
        marketplace: 'ozon',
        productId: 'bbb',
        url: 'https://ozon.ru/bbb',
        price: 105,
      },
    ]);
    expect(offers).toHaveLength(2);
    expect(offers.every((o) => o.marketplace === 'ozon')).toBe(true);
  });

  it('dedupes same marketplace:productId preferring priced offer', () => {
    const offers = mergeSeoOffers(
      [
        {
          marketplace: 'ozon',
          productId: '1',
          url: 'https://ozon.ru/1',
          price: null,
        },
      ],
      [
        {
          marketplace: 'ozon',
          productId: '1',
          url: 'https://ozon.ru/1',
          price: 200,
        },
      ],
    );
    expect(offers).toHaveLength(1);
    expect(offers[0].price).toBe(200);
  });

  it('caps at SEO_MAX_OFFERS', () => {
    const many: SeoOfferSnapshot[] = Array.from({ length: 12 }, (_, i) => ({
      marketplace: 'ozon',
      productId: String(i),
      url: `https://ozon.ru/${i}`,
      price: i,
    }));
    expect(mergeSeoOffers(many).length).toBeLessThanOrEqual(SEO_MAX_OFFERS);
  });
});

describe('countPricedOffers', () => {
  it('counts only positive prices', () => {
    expect(
      countPricedOffers([
        { marketplace: 'ozon', productId: '1', url: 'u', price: 100 },
        { marketplace: 'wildberries', productId: '2', url: 'u2', price: null },
        { marketplace: 'yandex_market', productId: '3', url: 'u3', price: 0 },
      ]),
    ).toBe(1);
  });

  it('returns 0 for non-arrays', () => {
    expect(countPricedOffers(null)).toBe(0);
    expect(countPricedOffers({})).toBe(0);
  });
});
