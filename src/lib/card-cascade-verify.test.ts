import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/offer-fetch', () => ({
  fetchOfferFromUrl: vi.fn(),
}));

import { fetchOfferFromUrl } from '@/lib/offer-fetch';
import {
  collectSerpCascadeCandidates,
  pickSerpOrCardPrice,
  verifySerpOfferWithCardCascade,
} from '@/lib/card-cascade-verify';
import type { MarketplaceOffer } from '@/types/comparison';

const searchUrl = 'https://www.ozon.ru/search/?text=airpods+max';

function serpOffer(partial: Partial<MarketplaceOffer>): MarketplaceOffer {
  return {
    marketplace: 'ozon',
    title: 'Apple AirPods Max',
    price: 50000,
    delivery: null,
    rating: null,
    url: 'https://www.ozon.ru/product/airpods-max-1/',
    found: true,
    matchConfidence: 92,
    ...partial,
  };
}

describe('pickSerpOrCardPrice', () => {
  it('keeps cheaper SERP from-price over dearer card default (YM)', () => {
    expect(pickSerpOrCardPrice(24_682, 34_549)).toBe(24_682);
    expect(pickSerpOrCardPrice(34_549, 24_682)).toBe(24_682);
    expect(pickSerpOrCardPrice(null, 34_549)).toBe(34_549);
    expect(pickSerpOrCardPrice(24_682, null)).toBe(24_682);
  });
});

describe('collectSerpCascadeCandidates', () => {
  it('skips search-page URLs and keeps product cards', () => {
    const offer = serpOffer({
      url: searchUrl,
      found: false,
      needsManualPick: true,
      searchCandidates: [
        {
          title: 'AirPods Max Midnight',
          url: 'https://www.ozon.ru/product/airpods-max-midnight/',
          price: 49990,
          matchConfidence: 95,
          priority: 100,
        },
        {
          title: 'Bad',
          url: searchUrl,
          price: 100,
          matchConfidence: 50,
          priority: 90,
        },
      ],
    });

    const list = collectSerpCascadeCandidates(offer);
    expect(list).toHaveLength(1);
    expect(list[0]!.url).toContain('/product/');
  });
});

describe('verifySerpOfferWithCardCascade', () => {
  beforeEach(() => {
    vi.mocked(fetchOfferFromUrl).mockReset();
  });

  it('auto-picks when a single card clears the verify threshold', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue({
      marketplace: 'ozon',
      title: 'Apple AirPods Max USB-C Midnight',
      price: 49990,
      delivery: null,
      rating: 4.9,
      url: 'https://www.ozon.ru/product/airpods-max-midnight/',
      found: true,
    });

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        url: 'https://www.ozon.ru/product/airpods-max-midnight/',
        title: 'AirPods Max Midnight',
        matchConfidence: 88,
      }),
      {
        referenceTitle: 'Apple AirPods Max USB-C Midnight',
        query: 'Apple AirPods Max',
        searchUrl,
      },
    );

    expect(result.found).toBe(true);
    expect(result.needsManualPick).toBeFalsy();
    expect(result.url).toContain('/product/');
    expect(result.url).not.toContain('/search');
    expect(result.rating).toBe(4.9);
    expect(fetchOfferFromUrl).toHaveBeenCalled();
  });

  it('auto-picks single SERP candidate ≥95 when card fetch fails (keeps SERP rating)', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue(null);

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        found: false,
        price: null,
        rating: null,
        url: searchUrl,
        needsManualPick: true,
        matchConfidence: 97,
        searchCandidates: [
          {
            title: 'Xiaomi Redmi 15C 8+256',
            url: 'https://www.wildberries.ru/catalog/123/detail.aspx',
            price: 13337,
            matchConfidence: 97,
            priority: 100,
            rating: 4.9,
          },
        ],
      }),
      {
        referenceTitle: 'Xiaomi Redmi 15C 8 256',
        query: 'Xiaomi Redmi 15C',
        searchUrl: 'https://www.wildberries.ru/catalog/0/search.aspx?search=xiaomi',
      },
    );

    expect(result.found).toBe(true);
    expect(result.needsManualPick).toBeFalsy();
    expect(result.matchStatus).toBe('verified');
    expect(result.price).toBe(13337);
    expect(result.rating).toBe(4.9);
    expect(result.url).toContain('/catalog/123/');
  });

  it('keeps needs_choice for single SERP candidate below AUTO_PICK when cards fail', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue(null);

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        found: false,
        price: null,
        url: searchUrl,
        needsManualPick: true,
        searchCandidates: [
          {
            title: 'AirPods Max',
            url: 'https://www.ozon.ru/product/airpods-max-1/',
            price: 49990,
            matchConfidence: 60,
            priority: 100,
            rating: 4.8,
          },
        ],
      }),
      {
        referenceTitle: 'Apple AirPods Max',
        query: 'Apple AirPods Max',
        searchUrl,
      },
    );

    expect(result.found).toBe(false);
    expect(result.needsManualPick).toBe(true);
    expect(result.matchStatus).toBe('needs_choice');
    expect(result.rating).toBe(4.8);
    expect(result.searchCandidates).toHaveLength(1);
  });

  it('keeps needs_choice for 2+ candidates even when top score ≥95', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue(null);

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        found: false,
        price: null,
        url: searchUrl,
        needsManualPick: true,
        searchCandidates: [
          {
            title: 'AirPods Max A',
            url: 'https://www.ozon.ru/product/airpods-a/',
            price: 49990,
            matchConfidence: 97,
            priority: 100,
            rating: 4.9,
          },
          {
            title: 'AirPods Max B',
            url: 'https://www.ozon.ru/product/airpods-b/',
            price: 48990,
            matchConfidence: 96,
            priority: 99,
            rating: 4.8,
          },
        ],
      }),
      {
        referenceTitle: 'Apple AirPods Max',
        query: 'Apple AirPods Max',
        searchUrl,
      },
    );

    expect(result.found).toBe(false);
    expect(result.needsManualPick).toBe(true);
    expect(result.searchCandidates?.length).toBe(2);
    expect(result.url).toBe(searchUrl);
    expect(result.error).toMatch(/Выберите товар \(2\)/);
  });

  it('uses SERP candidate rating when card returns price without rating', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue({
      marketplace: 'ozon',
      title: 'Apple AirPods Max USB-C Midnight',
      price: 49990,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/airpods-max-midnight/',
      found: true,
    });

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        found: false,
        price: null,
        url: searchUrl,
        needsManualPick: true,
        searchCandidates: [
          {
            title: 'AirPods Max Midnight',
            url: 'https://www.ozon.ru/product/airpods-max-midnight/',
            price: 49990,
            matchConfidence: 96,
            priority: 100,
            rating: 4.9,
          },
        ],
      }),
      {
        referenceTitle: 'Apple AirPods Max USB-C Midnight',
        query: 'Apple AirPods Max',
        searchUrl,
      },
    );

    expect(result.found).toBe(true);
    expect(result.needsManualPick).toBeFalsy();
    expect(result.rating).toBe(4.9);
  });

  it('uses card title in needs_choice when SERP title is promo badge', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue({
      marketplace: 'ozon',
      title: 'Apple Смартфон iPhone 17 Pro Sim+eSim 12/256Gb',
      price: 100328,
      delivery: null,
      rating: 4.8,
      url: 'https://www.ozon.ru/product/apple-iphone-17-pro-123/',
      found: true,
    });

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        found: false,
        price: null,
        url: searchUrl,
        needsManualPick: true,
        searchCandidates: [
          {
            title: '250 баллов',
            url: 'https://www.ozon.ru/product/apple-iphone-17-pro-123/',
            price: 100328,
            matchConfidence: 60,
            priority: 100,
          },
        ],
      }),
      {
        referenceTitle: 'Совсем другой товар XYZ-9000',
        query: 'iPhone 17 Pro',
        searchUrl,
      },
    );

    expect(result.needsManualPick).toBe(true);
    expect(result.searchCandidates?.[0]?.title).toMatch(/iPhone 17 Pro/i);
    expect(result.searchCandidates?.[0]?.title).not.toMatch(/балл/i);
  });

  it('returns needs_choice with SERP pool when all card fetches fail', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue(null);

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        price: 50000,
        found: true,
        url: 'https://www.ozon.ru/product/airpods-max-1/',
        title: 'AirPods Max',
        matchConfidence: 60,
      }),
      {
        referenceTitle: 'Apple AirPods Max',
        query: 'Apple AirPods Max',
        searchUrl,
      },
    );

    expect(result.found).toBe(false);
    expect(result.needsManualPick).toBe(true);
    expect(result.matchStatus).toBe('needs_choice');
    expect(result.url).toBe(searchUrl);
    expect(result.url).toMatch(/\/search/i);
    expect(result.searchCandidates?.length).toBeGreaterThanOrEqual(1);
    expect(result.error).toMatch(/Выберите товар/i);
  });

  it('auto-picks best card among several that pass threshold (variant B)', async () => {
    vi.mocked(fetchOfferFromUrl)
      .mockResolvedValueOnce({
        marketplace: 'ozon',
        title: 'Apple AirPods Max USB-C Midnight',
        price: 49990,
        delivery: null,
        rating: 4.9,
        url: 'https://www.ozon.ru/product/airpods-max-midnight/',
        found: true,
      })
      .mockResolvedValueOnce({
        marketplace: 'ozon',
        title: 'Apple AirPods Max USB-C Space Gray',
        price: 50990,
        delivery: null,
        rating: 4.8,
        url: 'https://www.ozon.ru/product/airpods-max-space/',
        found: true,
      });

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        found: false,
        price: null,
        url: searchUrl,
        needsManualPick: true,
        searchCandidates: [
          {
            title: 'AirPods Max Midnight',
            url: 'https://www.ozon.ru/product/airpods-max-midnight/',
            price: 49990,
            matchConfidence: 96,
            priority: 100,
          },
          {
            title: 'AirPods Max Space Gray',
            url: 'https://www.ozon.ru/product/airpods-max-space/',
            price: 50990,
            matchConfidence: 95,
            priority: 99,
          },
        ],
      }),
      {
        referenceTitle: 'Apple AirPods Max USB-C Midnight',
        query: 'Apple AirPods Max',
        searchUrl,
      },
    );

    expect(result.found).toBe(true);
    expect(result.needsManualPick).toBeFalsy();
    expect(result.url).toContain('/product/');
    expect(result.url).not.toMatch(/\/search\?/i);
    expect(result.price).toBeGreaterThan(0);
  });

  it('tries the next candidate when the first card is a weak match', async () => {
    vi.mocked(fetchOfferFromUrl)
      .mockResolvedValueOnce({
        marketplace: 'ozon',
        title: 'Чехол для наушников',
        price: 990,
        delivery: null,
        rating: 4,
        url: 'https://www.ozon.ru/product/case-1/',
        found: true,
      })
      .mockResolvedValueOnce({
        marketplace: 'ozon',
        title: 'Apple AirPods Max USB-C Midnight',
        price: 49990,
        delivery: null,
        rating: 4.9,
        url: 'https://www.ozon.ru/product/airpods-max-midnight/',
        found: true,
      });

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        found: false,
        price: null,
        url: searchUrl,
        needsManualPick: true,
        searchCandidates: [
          {
            title: 'Чехол',
            url: 'https://www.ozon.ru/product/case-1/',
            price: 990,
            matchConfidence: 40,
            priority: 100,
          },
          {
            title: 'AirPods Max Midnight',
            url: 'https://www.ozon.ru/product/airpods-max-midnight/',
            price: 49990,
            matchConfidence: 90,
            priority: 99,
          },
        ],
      }),
      {
        referenceTitle: 'Apple AirPods Max USB-C Midnight',
        query: 'Apple AirPods Max',
        searchUrl,
      },
    );

    expect(result.found).toBe(true);
    expect(result.url).toContain('airpods-max-midnight');
    expect(fetchOfferFromUrl).toHaveBeenCalledTimes(2);
  });

  it('does not SERP-price auto-pick when the only card is OOS', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue({
      marketplace: 'wildberries',
      title: 'Apple AirPods Max USB-C Midnight',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.wildberries.ru/catalog/123/detail.aspx',
      found: false,
      error: 'Нет в наличии',
      matchStatus: 'oos',
    });

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        marketplace: 'wildberries',
        found: false,
        price: null,
        url: 'https://www.wildberries.ru/catalog/0/search.aspx?search=airpods',
        needsManualPick: true,
        searchCandidates: [
          {
            title: 'Apple AirPods Max USB-C Midnight',
            url: 'https://www.wildberries.ru/catalog/123/detail.aspx',
            price: 49990,
            matchConfidence: 98,
            priority: 100,
          },
        ],
      }),
      {
        referenceTitle: 'Apple AirPods Max USB-C Midnight',
        query: 'Apple AirPods Max',
        searchUrl: 'https://www.wildberries.ru/catalog/0/search.aspx?search=airpods',
      },
    );

    expect(result.found).toBe(false);
    expect(result.needsManualPick).toBeFalsy();
    expect(result.price).toBeNull();
    expect(result.matchStatus).toBe('not_found');
    expect(result.error).toMatch(/наличии|категор/i);
  });

  it('skips OOS first card and verifies the next in-stock card', async () => {
    vi.mocked(fetchOfferFromUrl)
      .mockResolvedValueOnce({
        marketplace: 'ozon',
        title: 'Apple AirPods Max USB-C Midnight',
        price: null,
        delivery: null,
        rating: null,
        url: 'https://www.ozon.ru/product/airpods-oos/',
        found: false,
        error: 'Нет в наличии',
        matchStatus: 'oos',
      })
      .mockResolvedValueOnce({
        marketplace: 'ozon',
        title: 'Apple AirPods Max USB-C Midnight',
        price: 49990,
        delivery: null,
        rating: 4.9,
        url: 'https://www.ozon.ru/product/airpods-max-midnight/',
        found: true,
      });

    const result = await verifySerpOfferWithCardCascade(
      serpOffer({
        found: false,
        price: null,
        url: searchUrl,
        needsManualPick: true,
        searchCandidates: [
          {
            title: 'Apple AirPods Max USB-C Midnight',
            url: 'https://www.ozon.ru/product/airpods-oos/',
            price: 48000,
            matchConfidence: 95,
            priority: 100,
          },
          {
            title: 'Apple AirPods Max USB-C Midnight',
            url: 'https://www.ozon.ru/product/airpods-max-midnight/',
            price: 49990,
            matchConfidence: 94,
            priority: 99,
          },
        ],
      }),
      {
        referenceTitle: 'Apple AirPods Max USB-C Midnight',
        query: 'Apple AirPods Max',
        searchUrl,
      },
    );

    expect(result.found).toBe(true);
    expect(result.url).toContain('airpods-max-midnight');
    expect(result.price).toBe(49990);
  });

  it('auto-picks unambiguous Pixel SERP without opening the card (YM /card/)', async () => {
    const { tryUnambiguousSerpVerified } = await import('@/lib/serp-auto-pick');
    const result = tryUnambiguousSerpVerified('yandex_market', [
      {
        title: 'Смартфон Google Pixel 8 8/128Gb Lemongrass',
        url: 'https://market.yandex.ru/card/google-pixel-8/123456',
        price: 42990,
        confidence: 86,
      },
    ]);

    expect(result?.found).toBe(true);
    expect(result?.needsManualPick).toBeFalsy();
    expect(result?.url).toContain('/card/');
    expect(result?.url).not.toMatch(/\/search/i);
  });

  it('keeps needs_choice for mixed Pixel generations when cards fail (not not_found)', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue(null);

    const result = await verifySerpOfferWithCardCascade(
      {
        marketplace: 'yandex_market',
        title: 'Google Pixel',
        price: null,
        delivery: null,
        rating: null,
        url: 'https://market.yandex.ru/search?text=pixel',
        found: false,
        needsManualPick: true,
        searchCandidates: [
          {
            title: 'Смартфон Google Pixel 7 8/128Gb Lemongrass',
            url: 'https://market.yandex.ru/card/pixel-7/111',
            price: 24682,
            matchConfidence: 48,
            priority: 100,
          },
          {
            title: 'Смартфон Google Pixel 9a 128 ГБ',
            url: 'https://market.yandex.ru/card/pixel-9a/222',
            price: 39270,
            matchConfidence: 52,
            priority: 99,
          },
          {
            title: 'Смартфон Google Pixel 10a 8/128Gb',
            url: 'https://market.yandex.ru/card/pixel-10a/333',
            price: 47467,
            matchConfidence: 50,
            priority: 98,
          },
        ],
      },
      {
        referenceTitle: 'Смартфон Google Pixel 8 8/128Gb светло-желтый Lemongrass',
        query: 'Google Pixel 8 128',
        searchUrl: 'https://market.yandex.ru/search?text=pixel',
      },
    );

    expect(result.found).toBe(false);
    expect(result.needsManualPick).toBe(true);
    expect(result.matchStatus).toBe('needs_choice');
    expect(result.searchCandidates?.length).toBe(3);
    expect(result.error).toMatch(/Выберите товар \(3\)/);
    expect(result.matchStatus).not.toBe('not_found');
  });

  it('picker keeps SERP from-price when card default is dearer (YM)', async () => {
    vi.mocked(fetchOfferFromUrl).mockImplementation(async (url) => ({
      marketplace: 'yandex_market',
      title: 'Смартфон Google Pixel 7 8/128Gb Lemongrass',
      price: 34_549,
      delivery: null,
      rating: 5,
      url,
      found: true,
    }));

    const result = await verifySerpOfferWithCardCascade(
      {
        marketplace: 'yandex_market',
        title: 'Google Pixel 7',
        price: null,
        delivery: null,
        rating: null,
        url: 'https://market.yandex.ru/search?text=pixel+7',
        found: false,
        needsManualPick: true,
        searchCandidates: [
          {
            title: 'Смартфон Google Pixel 7 8/128Gb Lemongrass',
            url: 'https://market.yandex.ru/card/pixel-7/111',
            price: 24_682,
            matchConfidence: 88,
            priority: 100,
          },
          {
            title: 'Смартфон Google Pixel 7 8/128Gb',
            url: 'https://market.yandex.ru/card/pixel-7-b/222',
            price: 34_911,
            matchConfidence: 86,
            priority: 99,
          },
        ],
      },
      {
        referenceTitle: 'Смартфон Google Pixel 7 8/128Gb Lemongrass',
        query: 'Google Pixel 7 128',
        searchUrl: 'https://market.yandex.ru/search?text=pixel+7',
      },
    );

    // Either auto-picked or choice — displayed candidate prices must keep SERP floor
    if (result.found && result.price != null) {
      expect(result.price).toBeLessThanOrEqual(24_682);
    } else {
      const prices = (result.searchCandidates ?? []).map((c) => c.price).filter((p): p is number => p != null);
      expect(prices.some((p) => p <= 24_682)).toBe(true);
      expect(Math.min(...prices)).toBeLessThanOrEqual(24_682);
    }
  });
});
