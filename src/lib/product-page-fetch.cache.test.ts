import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const putSharedPriceCache = vi.fn().mockResolvedValue(undefined);
const getSharedPriceCache = vi.fn().mockResolvedValue(null);

vi.stubGlobal('chrome', {
  tabs: {
    get: vi.fn(async () => ({ url: 'https://www.ozon.ru/product/tv-123456/' })),
    onUpdated: {
      addListener: vi.fn((listener) => {
        queueMicrotask(() => listener(1, { status: 'complete' }));
      }),
      removeListener: vi.fn(),
    },
  },
});

vi.mock('@/lib/supabase/price-cache', () => ({
  getSharedPriceCache: (...args: unknown[]) => getSharedPriceCache(...args),
  putSharedPriceCache: (...args: unknown[]) => putSharedPriceCache(...args),
}));

vi.mock('@/lib/ozon-offer', () => ({
  fetchOzonOfferFromPage: vi.fn(),
}));

vi.mock('@/lib/yandex-offer', () => ({
  fetchYandexOfferFromPage: vi.fn(),
}));

vi.mock('@/utils/parsers/wb-api', () => ({
  fetchWildberriesProduct: vi.fn(),
}));

vi.mock('@/lib/premium-unlocker-offer', () => ({
  fetchOfferViaPremiumUnlocker: vi.fn(),
}));

vi.mock('@/lib/hidden-browser', () => ({
  acquireHiddenBrowser: vi.fn(() => ({
    runExclusive: vi.fn(async (fn) => fn(async () => 1)),
  })),
  releaseHiddenBrowser: vi.fn(),
}));

vi.mock('@/lib/safe-messaging', () => ({
  ensureContentScriptReady: vi.fn(),
  safeSendMessage: vi.fn(),
}));

vi.mock('@/lib/empty-scrape-guard', () => ({
  noteEmptyScrape: vi.fn(),
  resetEmptyScrape: vi.fn(),
  shouldSkipTabScrape: vi.fn(() => false),
}));

import { acquireHiddenBrowser } from '@/lib/hidden-browser';
import { fetchOzonOfferFromPage } from '@/lib/ozon-offer';
import { fetchOfferViaPremiumUnlocker } from '@/lib/premium-unlocker-offer';
import { fetchOfferWithFallback } from '@/lib/product-page-fetch';
import { safeSendMessage } from '@/lib/safe-messaging';
import { fetchWildberriesProduct } from '@/utils/parsers/wb-api';

async function withFakeTimers(run: () => unknown | Promise<unknown>) {
  vi.useFakeTimers();
  try {
    const pending = run();
    await vi.runAllTimersAsync();
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

describe('fetchOfferWithFallback cache hygiene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSharedPriceCache.mockResolvedValue(null);
    putSharedPriceCache.mockResolvedValue(undefined);
    vi.mocked(fetchWildberriesProduct).mockResolvedValue(null);
    vi.mocked(fetchOzonOfferFromPage).mockResolvedValue(null);
    vi.mocked(fetchOfferViaPremiumUnlocker).mockResolvedValue(null);
    vi.mocked(safeSendMessage).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not put HiddenBrowser scrape into shared cache', async () => {
    vi.mocked(safeSendMessage).mockResolvedValue({
      ok: true,
      product: {
        id: '1',
        title: 'Session TV',
        price: 55_000,
        url: 'https://www.ozon.ru/product/tv-123456/',
        marketplace: 'ozon',
        scrapedAt: new Date().toISOString(),
      },
    });

    const offer = await withFakeTimers(() =>
      fetchOfferWithFallback('https://www.ozon.ru/product/tv-123456/', 'ozon', {
        forceTab: true,
        skipUnlocker: true,
      }),
    );

    expect((offer as any)?.price).toBe(55_000);
    expect(putSharedPriceCache).not.toHaveBeenCalled();
  });

  it('puts API offer into shared cache', async () => {
    vi.mocked(fetchWildberriesProduct).mockResolvedValue({
      title: 'WB API item',
      price: 12_000,
      oldPrice: undefined,
      imageUrl: 'https://example.com/wb/1.webp',
      imageUrlAlternatives: ['https://example.com/wb/1a.webp'],
      delivery: null,
      reviewRating: 4.5,
      feedbacks: 10,
    });

    const offer = await fetchOfferWithFallback(
      'https://www.wildberries.ru/catalog/12345678/detail.aspx',
      'wildberries',
    );

    expect(offer?.price).toBe(12_000);
    expect(putSharedPriceCache).toHaveBeenCalledTimes(1);
    expect(putSharedPriceCache.mock.calls[0][0]).toMatchObject({
      marketplace: 'wildberries',
      productId: '12345678',
      price: 12_000,
    });
  });

  it('forceTab does not short-circuit on shared cache hit', async () => {
    getSharedPriceCache.mockResolvedValue({
      price: 99_000,
      title: 'Cached',
      url: 'https://www.ozon.ru/product/tv-123456/',
    });
    vi.mocked(safeSendMessage).mockResolvedValue({
      ok: true,
      product: {
        id: '1',
        title: 'Live',
        price: 88_000,
        url: 'https://www.ozon.ru/product/tv-123456/',
        marketplace: 'ozon',
        scrapedAt: new Date().toISOString(),
      },
    });

    const offer = await withFakeTimers(() =>
      fetchOfferWithFallback('https://www.ozon.ru/product/tv-123456/', 'ozon', {
        forceTab: true,
        skipUnlocker: true,
      }),
    );

    expect((offer as any)?.price).toBe(88_000);
    expect((offer as any)?.title).toBe('Live');
  });

  it('without forceTab returns shared cache first', async () => {
    getSharedPriceCache.mockResolvedValue({
      price: 77_000,
      title: 'Cached first',
      url: 'https://www.ozon.ru/product/tv-123456/',
    });

    const offer = await fetchOfferWithFallback(
      'https://www.ozon.ru/product/tv-123456/',
      'ozon',
    );

    expect(offer?.price).toBe(77_000);
    expect(fetchOzonOfferFromPage).not.toHaveBeenCalled();
  });

  it('megamarket fresh shared cache skips HiddenBrowser tab', async () => {
    getSharedPriceCache.mockResolvedValue({
      price: 45_990,
      title: 'Mega cached phone',
      url: 'https://megamarket.ru/catalog/details/smartfon-100067205836/',
    });

    const offer = await fetchOfferWithFallback(
      'https://megamarket.ru/catalog/details/smartfon-100067205836/',
      'megamarket',
    );

    expect(offer?.price).toBe(45_990);
    expect(offer?.title).toBe('Mega cached phone');
    expect(getSharedPriceCache).toHaveBeenCalledWith('megamarket', '100067205836');
    expect(acquireHiddenBrowser).not.toHaveBeenCalled();
    expect(fetchOfferViaPremiumUnlocker).not.toHaveBeenCalled();
    expect(safeSendMessage).not.toHaveBeenCalled();
  });

  it('ALI-4: aliexpress fresh shared cache skips HiddenBrowser tab', async () => {
    getSharedPriceCache.mockResolvedValue({
      price: 1_990,
      title: 'Ali cached case',
      url: 'https://aliexpress.ru/item/1005001234567890.html',
    });

    const offer = await fetchOfferWithFallback(
      'https://aliexpress.ru/item/1005001234567890.html',
      'aliexpress',
    );

    expect(offer?.price).toBe(1_990);
    expect(offer?.title).toBe('Ali cached case');
    expect(getSharedPriceCache).toHaveBeenCalledWith('aliexpress', '1005001234567890');
    expect(acquireHiddenBrowser).not.toHaveBeenCalled();
    expect(fetchOfferViaPremiumUnlocker).not.toHaveBeenCalled();
    expect(safeSendMessage).not.toHaveBeenCalled();
  });
});
