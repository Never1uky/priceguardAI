import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchViaBrowserTab = vi.fn();
const fetchOfferFromUrl = vi.fn();

vi.mock('@/lib/compare-tab-search', () => ({
  searchViaBrowserTab: (...args: unknown[]) => searchViaBrowserTab(...args),
}));

vi.mock('@/lib/offer-fetch', () => ({
  fetchOfferFromUrl: (...args: unknown[]) => fetchOfferFromUrl(...args),
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
  fetchWithRetry: vi.fn().mockRejectedValue(new Error('no network in unit test')),
}));

import { searchMarketplaceWithFallback } from '@/lib/marketplace-search';
import { resetAllEmptyScrapes } from '@/lib/empty-scrape-guard';

describe('searchMarketplaceWithFallback — SERP tab after failed cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllEmptyScrapes();
    fetchOfferFromUrl.mockResolvedValue(null);
  });

  it('ozon: opens HiddenBrowser SERP even when API would yield needs_choice', async () => {
    searchViaBrowserTab.mockResolvedValue({
      marketplace: 'ozon',
      title: 'query',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/buds-1/',
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
      searchCandidates: [
        {
          title: 'Redmi Buds',
          url: 'https://www.ozon.ru/product/buds-1/',
          price: 2499,
          matchConfidence: 88,
          priority: 100,
        },
      ],
    });

    const result = await searchMarketplaceWithFallback(
      'ozon',
      'Xiaomi Redmi Buds 8',
      'Xiaomi Беспроводные наушники REDMI Buds 8 White',
      3647,
    );

    expect(searchViaBrowserTab).toHaveBeenCalled();
    // Cascade cards failed → needs_choice after SERP is fine; must not be silent skip of tab
    expect(result.needsManualPick || result.found || result.error).toBeTruthy();
  });

  it('wildberries: after API cascade needs_choice, still calls searchViaBrowserTab', async () => {
    // WB search API will fail (fetch mocked) → notFound from API path → SERP tab
    searchViaBrowserTab.mockResolvedValue({
      marketplace: 'wildberries',
      title: 'query',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.wildberries.ru/catalog/123/detail.aspx',
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
      searchCandidates: [
        {
          title: 'Redmi Buds',
          url: 'https://www.wildberries.ru/catalog/123/detail.aspx',
          price: 3000,
          matchConfidence: 80,
          priority: 100,
        },
      ],
    });

    await searchMarketplaceWithFallback(
      'wildberries',
      'Redmi Buds 8',
      'Xiaomi REDMI Buds 8 White',
      3647,
    );

    expect(searchViaBrowserTab).toHaveBeenCalled();
  });
});
