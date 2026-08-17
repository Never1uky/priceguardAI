import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchViaBrowserTab = vi.fn();
const searchViaOpenSerpTab = vi.fn();
const lookupCrossMarketMappings = vi.fn();
const getSharedPriceCache = vi.fn();
const researchCompareViaEdge = vi.fn();
const verifySerpOfferWithCardCascade = vi.fn();
const enrichOfferFromProductPage = vi.fn();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({}),
    },
  },
  runtime: {
    getManifest: () => ({ version: '0.9.94-test' }),
  },
});

vi.mock('@/lib/compare-tab-search', () => ({
  searchViaBrowserTab: (...args: unknown[]) => searchViaBrowserTab(...args),
  searchViaOpenSerpTab: (...args: unknown[]) => searchViaOpenSerpTab(...args),
}));

vi.mock('@/lib/cross-market-map', () => ({
  lookupCrossMarketMappings: (...args: unknown[]) => lookupCrossMarketMappings(...args),
  rememberCrossMarketMapping: vi.fn(),
  reportCrossMarketMappingFail: vi.fn(),
  resolveSourceProductId: () => 'src-1',
}));

vi.mock('@/lib/supabase/price-cache', () => ({
  getSharedPriceCache: (...args: unknown[]) => getSharedPriceCache(...args),
  putSharedPriceCache: vi.fn(),
}));

vi.mock('@/lib/supabase/compare-research', () => ({
  researchCompareViaEdge: (...args: unknown[]) => researchCompareViaEdge(...args),
}));

vi.mock('@/lib/card-cascade-verify', () => ({
  verifySerpOfferWithCardCascade: (...args: unknown[]) => verifySerpOfferWithCardCascade(...args),
  collectSerpCascadeCandidates: vi.fn(() => []),
}));

vi.mock('@/lib/offer-fetch', () => ({
  fetchOfferFromUrl: vi.fn().mockResolvedValue(null),
  enrichOfferFromProductPage: (...args: unknown[]) => enrichOfferFromProductPage(...args),
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

import {
  compareProductAcrossMarketplaces,
  tryResolveFromCrossMarketMapping,
} from '@/lib/marketplace-search';
import { resetAllEmptyScrapes } from '@/lib/empty-scrape-guard';
import { pipelineMetrics } from '@/lib/pipeline-metrics';
import type { CompareProduct } from '@/types/comparison';

function product(): CompareProduct {
  return {
    id: 'p1',
    title: 'Samsung Наушники Galaxy Buds3 Pro Silver',
    sourceUrl: 'https://www.wildberries.ru/catalog/111/detail.aspx',
    sourceMarketplace: 'wildberries',
    article: 'src-1',
    sourceOffer: {
      marketplace: 'wildberries',
      title: 'Samsung Наушники Galaxy Buds3 Pro Silver',
      price: 12_990,
      delivery: null,
      rating: null,
      url: 'https://www.wildberries.ru/catalog/111/detail.aspx',
      found: true,
      matchStatus: 'verified',
    },
    marketplaceUrls: {},
    marketplaceOffers: {},
    addedAt: Date.now(),
  };
}

describe('mapping + price-cache before SERP (D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllEmptyScrapes();
    searchViaOpenSerpTab.mockResolvedValue(null);
    searchViaBrowserTab.mockResolvedValue({
      marketplace: 'ozon',
      title: 'query',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/search/?text=buds',
      found: false,
      matchStatus: 'not_found',
      error: 'not found',
    });
    researchCompareViaEdge.mockResolvedValue(null);
    enrichOfferFromProductPage.mockImplementation(async (o: unknown) => o);
  });

  it('tryResolveFromCrossMarketMapping: price-cache hit skips card/SERP', async () => {
    lookupCrossMarketMappings.mockResolvedValue([
      {
        sourceMarketplace: 'wildberries',
        sourceProductId: 'src-1',
        targetMarketplace: 'ozon',
        targetProductId: 'buds-1',
        targetUrl: 'https://www.ozon.ru/product/galaxy-buds-buds-1/',
        confidence: 92,
        evidence: 'manual',
        rank: 0,
      },
    ]);
    getSharedPriceCache.mockResolvedValue({
      price: 4090,
      title: 'Наушники Samsung Galaxy Buds3 Pro Silver',
      url: 'https://www.ozon.ru/product/galaxy-buds-buds-1/',
      rating: 4.8,
    });

    const offer = await tryResolveFromCrossMarketMapping(product(), 'ozon');

    expect(offer?.found).toBe(true);
    expect(offer?.price).toBe(4090);
    expect(offer?.matchStatus).toBe('verified');
    expect(pipelineMetrics.mappingHit).toHaveBeenCalled();
    expect(enrichOfferFromProductPage).not.toHaveBeenCalled();
  });

  it('compare research: mapping+cache binds Ozon without HiddenBrowser SERP', async () => {
    lookupCrossMarketMappings.mockResolvedValue([
      {
        sourceMarketplace: 'wildberries',
        sourceProductId: 'src-1',
        targetMarketplace: 'ozon',
        targetProductId: 'buds-1',
        targetUrl: 'https://www.ozon.ru/product/galaxy-buds-buds-1/',
        confidence: 90,
        evidence: 'multi_user',
        rank: 0,
      },
    ]);
    getSharedPriceCache.mockResolvedValue({
      price: 4090,
      title: 'Наушники Samsung Galaxy Buds3 Pro',
      url: 'https://www.ozon.ru/product/galaxy-buds-buds-1/',
    });

    const offers = await compareProductAcrossMarketplaces(product(), undefined, {
      allowSearch: true,
      onlyMarketplaces: ['ozon'],
    });

    const ozon = offers.find((o) => o.marketplace === 'ozon');
    expect(ozon?.found).toBe(true);
    expect(ozon?.price).toBe(4090);
    expect(searchViaBrowserTab).not.toHaveBeenCalled();
    expect(searchViaOpenSerpTab).not.toHaveBeenCalled();
    expect(researchCompareViaEdge).not.toHaveBeenCalled();
  });

  it('no mapping → still falls through to tab search', async () => {
    lookupCrossMarketMappings.mockResolvedValue([]);
    getSharedPriceCache.mockResolvedValue(null);

    await compareProductAcrossMarketplaces(product(), undefined, {
      allowSearch: true,
      onlyMarketplaces: ['ozon'],
    });

    expect(researchCompareViaEdge).toHaveBeenCalled();
    expect(searchViaOpenSerpTab).toHaveBeenCalled();
    expect(searchViaBrowserTab).toHaveBeenCalled();
  });
});
