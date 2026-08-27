import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchViaBrowserTab = vi.fn();
const searchViaOpenSerpTab = vi.fn();
const researchCompareViaEdge = vi.fn();
const verifySerpOfferWithCardCascade = vi.fn();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({}),
    },
  },
  runtime: {
    getManifest: () => ({ version: '0.9.02-test' }),
  },
});

vi.mock('@/lib/compare-tab-search', () => ({
  searchViaBrowserTab: (...args: unknown[]) => searchViaBrowserTab(...args),
  searchViaOpenSerpTab: (...args: unknown[]) => searchViaOpenSerpTab(...args),
  searchViaOpenProductTab: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/supabase/compare-research', () => ({
  researchCompareViaEdge: (...args: unknown[]) => researchCompareViaEdge(...args),
}));

vi.mock('@/lib/cross-market-map', () => ({
  lookupCrossMarketMappings: vi.fn().mockResolvedValue([]),
  rememberCrossMarketMapping: vi.fn(),
  reportCrossMarketMappingFail: vi.fn(),
  resolveSourceProductId: () => null,
}));

vi.mock('@/lib/supabase/price-cache', () => ({
  getSharedPriceCache: vi.fn().mockResolvedValue(null),
  putSharedPriceCache: vi.fn(),
}));

vi.mock('@/lib/card-cascade-verify', () => ({
  verifySerpOfferWithCardCascade: (...args: unknown[]) => verifySerpOfferWithCardCascade(...args),
  collectSerpCascadeCandidates: vi.fn(() => []),
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
    mappingHit: vi.fn(),
  },
}));

vi.mock('@/lib/fetch-retry', () => ({
  fetchWithRetry: vi.fn().mockRejectedValue(new Error('no network in unit test')),
  safeFetch: vi.fn().mockRejectedValue(new Error('no network in unit test')),
  apiErrorMessage: (mp: string) => `${mp}: api fail`,
  MARKETPLACE_SEARCH_RETRY: { retries: 0, retryOn: [500] },
  isMarketplaceSearchApiUrl: () => false,
}));

vi.mock('@/lib/offer-fetch', () => ({
  fetchOfferFromUrl: vi.fn().mockResolvedValue(null),
  enrichOfferFromProductPage: vi.fn(async (o: unknown) => o),
}));

import { compareProductAcrossMarketplaces } from '@/lib/marketplace-search';
import { resetAllEmptyScrapes } from '@/lib/empty-scrape-guard';
import type { CompareProduct } from '@/types/comparison';

function product(): CompareProduct {
  return {
    id: 'p1',
    title: 'Xiaomi REDMI Buds 8 White',
    sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
    sourceMarketplace: 'wildberries',
    sourceOffer: {
      marketplace: 'wildberries',
      title: 'Xiaomi REDMI Buds 8 White',
      price: 3647,
      delivery: null,
      rating: null,
      url: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      found: true,
      matchStatus: 'verified',
    },
    marketplaceUrls: {},
    marketplaceOffers: {},
    addedAt: Date.now(),
  };
}

describe('compareProductAcrossMarketplaces — Edge needs_choice → local SERP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllEmptyScrapes();
    searchViaOpenSerpTab.mockResolvedValue(null);
    researchCompareViaEdge.mockResolvedValue({
      ozon: {
        marketplace: 'ozon',
        title: 'Buds',
        price: null,
        delivery: null,
        rating: null,
        url: 'https://www.ozon.ru/product/a/',
        found: false,
        needsManualPick: true,
        matchStatus: 'needs_choice',
        searchCandidates: [
          {
            title: 'Buds',
            url: 'https://www.ozon.ru/product/a/',
            price: 2500,
            matchConfidence: 80,
            priority: 100,
          },
        ],
      },
    });
    verifySerpOfferWithCardCascade.mockResolvedValue({
      marketplace: 'ozon',
      title: 'Buds',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/a/',
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
      searchCandidates: [
        {
          title: 'Buds',
          url: 'https://www.ozon.ru/product/a/',
          price: 2500,
          matchConfidence: 80,
          priority: 100,
        },
      ],
    });
    searchViaBrowserTab.mockResolvedValue({
      marketplace: 'ozon',
      title: 'query',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/product/b/',
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
      searchCandidates: [
        {
          title: 'Buds from SERP',
          url: 'https://www.ozon.ru/product/b/',
          price: 2499,
          matchConfidence: 85,
          priority: 100,
        },
      ],
    });
  });

  it('does not finish on Edge needs_choice — calls HiddenBrowser SERP', async () => {
    await compareProductAcrossMarketplaces(product(), undefined, { allowSearch: true });

    expect(researchCompareViaEdge).toHaveBeenCalled();
    expect(verifySerpOfferWithCardCascade).toHaveBeenCalled();
    expect(searchViaBrowserTab).toHaveBeenCalled();
  });

  it('MEGA-5: Edge empty Mega (tab-or-available) → client HiddenBrowser SERP', async () => {
    researchCompareViaEdge.mockResolvedValue({});
    searchViaBrowserTab.mockResolvedValue({
      marketplace: 'megamarket',
      title: 'Pixel from tab',
      price: 79_990,
      delivery: null,
      rating: null,
      url: 'https://megamarket.ru/catalog/details/100067205836/',
      found: true,
      matchStatus: 'verified',
    });

    await compareProductAcrossMarketplaces(product(), undefined, {
      allowSearch: true,
      onlyMarketplaces: ['megamarket'],
    });

    expect(researchCompareViaEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMarketplace: 'wildberries',
        targetMarketplaces: expect.arrayContaining(['megamarket']),
      }),
    );
    expect(searchViaBrowserTab).toHaveBeenCalled();
    expect(searchViaBrowserTab.mock.calls.some((c) => c[0] === 'megamarket')).toBe(true);
  });
});
