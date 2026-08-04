import { describe, expect, it } from 'vitest';
import {
  isAlertableCompareOffer,
  planComparePriceAlerts,
  type PriceAlertSettings,
} from '@/lib/compare-price-alerts';
import type { CompareProduct, MarketplaceOffer } from '@/types/comparison';

const settings: PriceAlertSettings = {
  notificationsEnabled: true,
  minDropRub: 100,
  minDropPercent: 1,
  compareAlerts: true,
  telegramEnabled: true,
  telegramChatId: '1',
};

const ymUrl =
  'https://market.yandex.ru/card/televizor-led-samsung-55-ue55u8000fuxru-chernyy-smart/4573822572';
const ozonUrl =
  'https://www.ozon.ru/product/samsung-televizor-ue55u8000fuxce-crystal-smart-tv-55-4k-uhd-chernyy-4059384722/';
const wbIphone = 'https://www.wildberries.ru/catalog/5129523330/detail.aspx';
const ozonCheap = 'https://www.ozon.ru/product/iphone-fake-10990-999/';

function ymProduct(overrides?: Partial<CompareProduct>): CompareProduct {
  return {
    id: 'cmp-tv',
    title: 'Samsung Телевизор UE55U8000FUXRU 55"',
    sourceUrl: ymUrl,
    sourceMarketplace: 'yandex_market',
    marketplaceUrls: { yandex_market: ymUrl },
    sourceOffer: {
      marketplace: 'yandex_market',
      title: 'Samsung Телевизор UE55U8000FUXRU 55"',
      price: 44286,
      delivery: null,
      rating: null,
      url: ymUrl,
      found: true,
      matchStatus: 'verified',
    },
    marketplaceOffers: {
      yandex_market: {
        marketplace: 'yandex_market',
        title: 'Samsung Телевизор UE55U8000FUXRU 55"',
        price: 44286,
        delivery: null,
        rating: null,
        url: ymUrl,
        found: true,
        matchStatus: 'verified',
      },
    },
    addedAt: Date.now() - 2 * 60 * 60 * 1000,
    ...overrides,
  };
}

function offer(
  marketplace: MarketplaceOffer['marketplace'],
  price: number | null,
  url: string,
  extra?: Partial<MarketplaceOffer>,
): MarketplaceOffer {
  return {
    marketplace,
    title: 'Samsung TV',
    price,
    delivery: null,
    rating: null,
    url,
    found: price != null && price > 0,
    matchStatus: price != null && price > 0 ? 'verified' : undefined,
    ...extra,
  };
}

describe('planComparePriceAlerts', () => {
  it('first sibling find = baseline only (no alert)', () => {
    const product = ymProduct();
    const newOffers: MarketplaceOffer[] = [
      offer('yandex_market', 44286, ymUrl),
      offer('ozon', 39990, ozonUrl),
    ];
    expect(planComparePriceAlerts(product, newOffers, settings)).toHaveLength(0);
  });

  it('sibling improved after baseline → same-MP compare_price_drop on Ozon', () => {
    const product = ymProduct({
      marketplaceOffers: {
        yandex_market: offer('yandex_market', 44286, ymUrl),
        ozon: offer('ozon', 42000, ozonUrl),
      },
    });
    const newOffers: MarketplaceOffer[] = [
      offer('yandex_market', 44286, ymUrl),
      offer('ozon', 39990, ozonUrl),
    ];

    const plans = planComparePriceAlerts(product, newOffers, settings);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      kind: 'compare_price_drop',
      marketplace: 'ozon',
      previousPrice: 42000,
      newPrice: 39990,
      url: ozonUrl,
    });
  });

  it('price bleed on YM with Ozon baseline → cheaper_elsewhere, not YM drop', () => {
    const product = ymProduct({
      marketplaceOffers: {
        yandex_market: offer('yandex_market', 44286, ymUrl),
        ozon: offer('ozon', 41000, ozonUrl),
      },
    });
    const newOffers: MarketplaceOffer[] = [
      offer('yandex_market', 39990, ymUrl),
      offer('ozon', 39990, ozonUrl),
    ];

    const plans = planComparePriceAlerts(product, newOffers, settings);

    expect(
      plans.some((p) => p.kind === 'compare_price_drop' && p.marketplace === 'yandex_market'),
    ).toBe(false);
    expect(plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'cheaper_elsewhere',
          cheaperMarketplace: 'ozon',
          cheaperPrice: 39990,
          url: ozonUrl,
        }),
      ]),
    );
  });

  it('same-MP YM drop → compare_price_drop with YM url', () => {
    const product = ymProduct({
      sourceOffer: offer('yandex_market', 45000, ymUrl),
      marketplaceOffers: {
        yandex_market: offer('yandex_market', 45000, ymUrl),
      },
    });
    const newOffers: MarketplaceOffer[] = [
      offer('yandex_market', 42000, ymUrl),
      offer('ozon', null, '', { found: false, error: 'Не найдено' }),
    ];

    const plans = planComparePriceAlerts(product, newOffers, settings);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      kind: 'compare_price_drop',
      marketplace: 'yandex_market',
      previousPrice: 45000,
      newPrice: 42000,
      url: ymUrl,
    });
  });

  it('real YM drop while Ozon already cheaper → still YM compare_price_drop', () => {
    const product = ymProduct({
      sourceOffer: offer('yandex_market', 45000, ymUrl),
      marketplaceOffers: {
        yandex_market: offer('yandex_market', 45000, ymUrl),
        ozon: offer('ozon', 39990, ozonUrl),
      },
    });
    const newOffers: MarketplaceOffer[] = [
      offer('yandex_market', 42000, ymUrl),
      offer('ozon', 39990, ozonUrl),
    ];

    const plans = planComparePriceAlerts(product, newOffers, settings);
    expect(plans.find((p) => p.kind === 'compare_price_drop')).toMatchObject({
      marketplace: 'yandex_market',
      previousPrice: 45000,
      newPrice: 42000,
      url: ymUrl,
    });
  });

  it('rejects offer when url host does not match marketplace', () => {
    const product = ymProduct({
      marketplaceOffers: {
        yandex_market: offer('yandex_market', 44286, ymUrl),
        ozon: offer('ozon', 42000, ozonUrl),
      },
    });
    const newOffers: MarketplaceOffer[] = [
      offer('yandex_market', 44286, ymUrl),
      offer('ozon', 39990, ymUrl),
    ];
    expect(planComparePriceAlerts(product, newOffers, settings)).toHaveLength(0);
  });

  it('iPhone-scale cross-MP catastrophic drop is not planned', () => {
    const product: CompareProduct = {
      id: 'cmp-iphone',
      title: 'Смартфон iPhone 17 Pro Max 256GB',
      sourceUrl: wbIphone,
      sourceMarketplace: 'wildberries',
      marketplaceUrls: { wildberries: wbIphone },
      sourceOffer: offer('wildberries', 103_382, wbIphone),
      marketplaceOffers: {
        wildberries: offer('wildberries', 103_382, wbIphone),
        ozon: offer('ozon', 95_000, ozonCheap, { matchStatus: 'probable', title: 'iPhone case' }),
      },
      addedAt: Date.now() - 2 * 60 * 60 * 1000,
    };
    const newOffers: MarketplaceOffer[] = [
      offer('wildberries', 103_382, wbIphone),
      offer('ozon', 10_990, ozonCheap, {
        matchStatus: 'serp_only',
        title: 'Чехол / ASIS',
        found: true,
      }),
    ];
    expect(planComparePriceAlerts(product, newOffers, settings)).toHaveLength(0);
  });

  it('OOS / out-of-stock offer is not alertable', () => {
    expect(
      isAlertableCompareOffer(
        offer('ozon', 39990, ozonUrl, { matchStatus: 'oos', error: 'Нет в наличии' }),
      ),
    ).toBe(false);
    expect(
      isAlertableCompareOffer(
        offer('ozon', 39990, ozonUrl, { matchStatus: 'serp_only', error: 'Нет в наличии' }),
      ),
    ).toBe(false);
  });

  it('unverified_manual offer is not alertable', () => {
    expect(
      isAlertableCompareOffer(
        offer('ozon', 39990, ozonUrl, {
          matchStatus: 'unverified_manual',
          matchConfidence: 45,
        }),
      ),
    ).toBe(false);
  });
});
