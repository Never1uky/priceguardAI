import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchViaBrowserTab = vi.fn();
const searchViaOpenSerpTab = vi.fn();
const fetchOfferFromUrl = vi.fn();
const fetchWithRetry = vi.fn().mockRejectedValue(new Error('no network in unit test'));

vi.mock('@/lib/compare-tab-search', () => ({
  searchViaBrowserTab: (...args: unknown[]) => searchViaBrowserTab(...args),
  searchViaOpenSerpTab: (...args: unknown[]) => searchViaOpenSerpTab(...args),
  searchViaOpenProductTab: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/offer-fetch', () => ({
  fetchOfferFromUrl: (...args: unknown[]) => fetchOfferFromUrl(...args),
  enrichOfferFromProductPage: vi.fn(async (o: unknown) => o),
}));

vi.mock('@/lib/serp-cache', () => ({
  getSerpCachedOffer: vi.fn().mockResolvedValue(null),
  setSerpCachedOffer: vi.fn().mockResolvedValue(undefined),
  clearSerpNotFoundAndExpired: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/pipeline-metrics', () => ({
  pipelineMetrics: {
    apiSearchSuccess: vi.fn(),
    hiddenBrowserAttempt: vi.fn(),
    hiddenBrowserSuccess: vi.fn(),
  },
}));

vi.mock('@/lib/fetch-retry', () => ({
  fetchWithRetry: (...args: unknown[]) => fetchWithRetry(...args),
  safeFetch: vi.fn().mockRejectedValue(new Error('no network in unit test')),
  apiErrorMessage: (mp: string, status?: number) => `${mp}: api ${status ?? 'fail'}`,
  MARKETPLACE_SEARCH_RETRY: { retries: 0, retryOn: [500, 502, 503, 504] },
  isMarketplaceSearchApiUrl: () => false,
}));

import { searchMarketplaceWithFallback } from '@/lib/marketplace-search';
import { resetAllEmptyScrapes } from '@/lib/empty-scrape-guard';

const notFoundYm = {
  marketplace: 'yandex_market' as const,
  title: 'Google Pixel',
  price: null,
  delivery: null,
  rating: null,
  url: 'https://market.yandex.ru/search?text=pixel',
  found: false,
  matchStatus: 'not_found' as const,
  error: 'Подходящий товар в выдаче не найден. Укажите ссылку вручную.',
};

const choiceOffer = (marketplace: 'ozon' | 'wildberries' | 'yandex_market', url: string) => ({
  marketplace,
  title: 'query',
  price: null,
  delivery: null,
  rating: null,
  url,
  found: false,
  needsManualPick: true,
  matchStatus: 'needs_choice' as const,
  searchCandidates: [
    {
      title: 'Redmi Buds',
      url,
      price: 2499,
      matchConfidence: 88,
      priority: 100,
    },
  ],
});

describe('searchMarketplaceWithFallback — tab-only search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllEmptyScrapes();
    fetchOfferFromUrl.mockResolvedValue(null);
    searchViaOpenSerpTab.mockResolvedValue(null);
  });

  it('ozon: opens HiddenBrowser SERP even when API would yield needs_choice', async () => {
    searchViaBrowserTab.mockResolvedValue(
      choiceOffer('ozon', 'https://www.ozon.ru/product/buds-1/'),
    );

    const result = await searchMarketplaceWithFallback(
      'ozon',
      'Xiaomi Redmi Buds 8',
      'Xiaomi Беспроводные наушники REDMI Buds 8 White',
      3647,
    );

    expect(searchViaBrowserTab).toHaveBeenCalled();
    expect(result.needsManualPick || result.found || result.error).toBeTruthy();
  });

  it('yandex_market: does not call unofficial search API after SERP not_found', async () => {
    searchViaBrowserTab.mockResolvedValue(notFoundYm);

    const result = await searchMarketplaceWithFallback(
      'yandex_market',
      'Google Pixel 8 128',
      'Смартфон Google Pixel 8 8/128Gb светло-желтый Lemongrass',
      45000,
    );

    expect(searchViaBrowserTab).toHaveBeenCalled();
    expect(fetchWithRetry).not.toHaveBeenCalled();
    expect(result.matchStatus === 'not_found' || result.error).toBeTruthy();
    expect(String(result.error ?? '')).not.toMatch(/лимит запросов|429/);
  });

  it('wildberries: HiddenBrowser SERP without search.wb.ru', async () => {
    searchViaBrowserTab.mockResolvedValue(
      choiceOffer('wildberries', 'https://www.wildberries.ru/catalog/123/detail.aspx'),
    );

    await searchMarketplaceWithFallback(
      'wildberries',
      'Redmi Buds 8',
      'Xiaomi REDMI Buds 8 White',
      3647,
    );

    expect(searchViaBrowserTab).toHaveBeenCalled();
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it('prefers an already-open SERP tab over HiddenBrowser', async () => {
    searchViaOpenSerpTab.mockResolvedValue(
      choiceOffer('yandex_market', 'https://market.yandex.ru/product/pixel-1'),
    );

    await searchMarketplaceWithFallback(
      'yandex_market',
      'Google Pixel 8 128',
      'Смартфон Google Pixel 8 8/128Gb светло-желтый Lemongrass',
      45000,
    );

    expect(searchViaOpenSerpTab).toHaveBeenCalled();
    expect(searchViaBrowserTab).not.toHaveBeenCalled();
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });
});
