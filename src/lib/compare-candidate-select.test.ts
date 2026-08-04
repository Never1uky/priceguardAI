import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/offer-fetch', () => ({
  fetchOfferFromUrl: vi.fn(),
}));

vi.mock('@/lib/marketplace-search', () => ({
  enrichOfferRatingIfMissing: vi.fn(async (o: unknown) => o),
}));

vi.mock('@/lib/comparison-storage', () => ({
  getCompareProducts: vi.fn(),
  saveCompareProducts: vi.fn(async () => undefined),
}));

vi.mock('@/lib/cross-market-map', () => ({
  rememberCrossMarketMapping: vi.fn(),
  resolveSourceProductId: vi.fn(() => 'src-1'),
}));

vi.mock('@/lib/match-feedback', () => ({
  recordMatchFeedback: vi.fn(),
}));

vi.mock('@/lib/pick-history', () => ({
  rememberPickHistory: vi.fn(async () => undefined),
}));

import { fetchOfferFromUrl } from '@/lib/offer-fetch';
import { getCompareProducts, saveCompareProducts } from '@/lib/comparison-storage';
import { selectCompareSearchCandidate } from '@/lib/compare-candidate-select';
import type { CompareProduct } from '@/types/comparison';

const product: CompareProduct = {
  id: 'cmp-1',
  title: 'Смартфон Xiaomi Redmi 15C',
  sourceUrl: 'https://market.yandex.ru/product/1',
  sourceMarketplace: 'yandex_market',
  marketplaceUrls: {},
  addedAt: Date.now(),
  marketplaceOffers: {
    wildberries: {
      marketplace: 'wildberries',
      title: 'Поиск',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.wildberries.ru/catalog/0/search.aspx?search=redmi',
      found: false,
      needsManualPick: true,
      searchCandidates: [
        {
          title: 'Смартфон Redmi 15C',
          url: 'https://www.wildberries.ru/catalog/111/detail.aspx',
          price: 8895,
          matchConfidence: 82,
        },
      ],
    },
  },
};

describe('selectCompareSearchCandidate', () => {
  beforeEach(() => {
    vi.mocked(getCompareProducts).mockResolvedValue([product]);
    vi.mocked(saveCompareProducts).mockResolvedValue(undefined);
  });

  it('falls back to SERP price when card fetch returns null', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue(null);

    const updated = await selectCompareSearchCandidate(
      'cmp-1',
      'wildberries',
      'https://www.wildberries.ru/catalog/111/detail.aspx',
      { title: 'UI title', price: 8895 },
    );

    const offer = updated.marketplaceOffers?.wildberries;
    expect(offer?.price).toBe(8895);
    expect(offer?.needsManualPick).toBe(false);
    expect(offer?.found).toBe(true);
  });

  it('keeps hint.rating on serp_only pick', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue(null);

    const updated = await selectCompareSearchCandidate(
      'cmp-1',
      'wildberries',
      'https://www.wildberries.ru/catalog/111/detail.aspx',
      { title: 'UI title', price: 8895, rating: 4.9 },
    );

    expect(updated.marketplaceOffers?.wildberries?.rating).toBe(4.9);
  });

  it('accepts relative YM path and ya.ru host', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue(null);
    const ymProduct: CompareProduct = {
      ...product,
      marketplaceOffers: {
        yandex_market: {
          marketplace: 'yandex_market',
          title: 'Поиск',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://market.yandex.ru/search?text=x',
          found: false,
          needsManualPick: true,
          searchCandidates: [
            {
              title: 'AirPods',
              url: 'https://ya.ru/t/AbCd12',
              price: 43936,
              matchConfidence: 80,
              rating: 4.9,
            },
          ],
        },
      },
    };
    vi.mocked(getCompareProducts).mockResolvedValue([ymProduct]);

    const updated = await selectCompareSearchCandidate(
      'cmp-1',
      'yandex_market',
      'https://ya.ru/t/AbCd12',
      { title: 'AirPods', price: 43936, rating: 4.9 },
    );
    expect(updated.marketplaceOffers?.yandex_market?.price).toBe(43936);
    expect(updated.marketplaceOffers?.yandex_market?.rating).toBe(4.9);
  });

  it('throws OOS message when card is out of stock and no SERP price', async () => {
    vi.mocked(fetchOfferFromUrl).mockResolvedValue({
      marketplace: 'wildberries',
      title: 'Товар',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.wildberries.ru/catalog/111/detail.aspx',
      found: false,
      error: 'Нет в наличии',
    });

    const bare: CompareProduct = {
      ...product,
      marketplaceOffers: {
        wildberries: {
          marketplace: 'wildberries',
          title: 'x',
          price: null,
          delivery: null,
          rating: null,
          url: 'https://www.wildberries.ru/catalog/0/search.aspx',
          found: false,
          needsManualPick: true,
          searchCandidates: [
            {
              title: 'x',
              url: 'https://www.wildberries.ru/catalog/111/detail.aspx',
              price: null,
              matchConfidence: 70,
            },
          ],
        },
      },
    };
    vi.mocked(getCompareProducts).mockResolvedValue([bare]);

    await expect(
      selectCompareSearchCandidate(
        'cmp-1',
        'wildberries',
        'https://www.wildberries.ru/catalog/111/detail.aspx',
      ),
    ).rejects.toThrow(/нет в наличии/i);
  });
});
