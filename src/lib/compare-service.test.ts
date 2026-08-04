import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompareProduct } from '@/types/comparison';

const compareAndUpdateProduct = vi.hoisted(() =>
  vi.fn<(product: CompareProduct, options?: unknown) => Promise<{ offers: []; product: CompareProduct }>>(),
);
const updateCompareProduct = vi.hoisted(() =>
  vi.fn<(product: CompareProduct) => Promise<void>>(),
);

vi.mock('@/lib/marketplace-search', () => ({
  compareAndUpdateProduct,
}));

vi.mock('@/lib/comparison-storage', () => ({
  updateCompareProduct,
  getCompareProducts: vi.fn(),
  setSelectedCompareId: vi.fn(),
}));

vi.mock('@/lib/compare-cache', () => ({
  shouldRunCompare: () => true,
}));

vi.mock('@/lib/compare-resolve', () => ({
  resolveAndAddCompareProduct: vi.fn(),
}));

vi.mock('@/lib/reviews/tab-resolver', () => ({
  isSameProductPage: () => false,
}));

import { researchSingleMarketplace } from '@/lib/compare-service';

function productWithOzonAndYmGap(): CompareProduct {
  return {
    id: 'p-single',
    title: 'Infinix GT 30 Pro',
    sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
    sourceMarketplace: 'wildberries',
    marketplaceUrls: {
      ozon: 'https://www.ozon.ru/product/ozon-1',
    },
    marketplaceOffers: {
      ozon: {
        marketplace: 'ozon',
        title: 'Infinix GT 30 Pro',
        price: 30_499,
        delivery: null,
        rating: 4.8,
        url: 'https://www.ozon.ru/product/ozon-1',
        found: true,
        matchStatus: 'verified',
      },
      yandex_market: {
        marketplace: 'yandex_market',
        title: '',
        price: null,
        delivery: null,
        rating: null,
        url: '',
        found: false,
        matchStatus: 'not_found',
        error: 'Яндекс.Маркет временно недоступен',
      },
    },
    addedAt: Date.now(),
  };
}

describe('researchSingleMarketplace', () => {
  beforeEach(() => {
    compareAndUpdateProduct.mockReset();
    updateCompareProduct.mockReset();
    updateCompareProduct.mockResolvedValue(undefined);
    compareAndUpdateProduct.mockImplementation(async (product) => ({
      offers: [],
      product,
    }));
  });

  it('clears only the target slot and passes onlyMarketplaces', async () => {
    const product = productWithOzonAndYmGap();

    await researchSingleMarketplace(product, 'yandex_market');

    expect(updateCompareProduct).toHaveBeenCalled();
    const cleared = updateCompareProduct.mock.calls[0]?.[0];
    expect(cleared).toBeDefined();
    expect(cleared!.marketplaceOffers?.ozon?.price).toBe(30_499);
    expect(cleared!.marketplaceUrls?.ozon).toBe('https://www.ozon.ru/product/ozon-1');
    expect(cleared!.marketplaceOffers?.yandex_market?.found).toBe(false);

    expect(compareAndUpdateProduct).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-single' }),
      expect.objectContaining({
        mode: 'research',
        onlyMarketplaces: ['yandex_market'],
      }),
    );
  });
});
