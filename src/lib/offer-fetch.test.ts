import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/product-page-fetch', () => ({
  fetchOfferWithFallback: vi.fn(),
}));

import { fetchOfferWithFallback } from '@/lib/product-page-fetch';
import { enrichOfferFromProductPage } from '@/lib/offer-fetch';
import type { MarketplaceOffer } from '@/types/comparison';

const base: MarketplaceOffer = {
  marketplace: 'wildberries',
  title: 'Haier TV',
  price: 52000,
  delivery: null,
  rating: 4.5,
  url: 'https://www.wildberries.ru/catalog/4433070312/detail.aspx',
  found: true,
  matchStatus: 'verified',
};

describe('enrichOfferFromProductPage', () => {
  beforeEach(() => {
    vi.mocked(fetchOfferWithFallback).mockReset();
  });

  it('does not keep stale price when card is OOS', async () => {
    vi.mocked(fetchOfferWithFallback).mockResolvedValue({
      marketplace: 'wildberries',
      title: 'Haier TV',
      price: null,
      delivery: null,
      rating: null,
      url: base.url,
      found: false,
      error: 'Нет в наличии',
      matchStatus: 'oos',
    });

    const next = await enrichOfferFromProductPage(base, { forceTab: true });
    expect(next.price).toBeNull();
    expect(next.found).toBe(false);
    expect(next.matchStatus).toBe('oos');
    expect(next.error).toMatch(/наличии/i);
  });

  it('does not keep stale price when fetch returns null', async () => {
    vi.mocked(fetchOfferWithFallback).mockResolvedValue(null);

    const next = await enrichOfferFromProductPage(base);
    expect(next.price).toBeNull();
    expect(next.found).toBe(false);
    expect(next.matchStatus).toBe('not_found');
  });

  it('merges priced card over base', async () => {
    vi.mocked(fetchOfferWithFallback).mockResolvedValue({
      marketplace: 'wildberries',
      title: 'Haier TV 65',
      price: 48000,
      delivery: null,
      rating: 4.8,
      url: base.url,
      found: true,
    });

    const next = await enrichOfferFromProductPage(base);
    expect(next.price).toBe(48000);
    expect(next.found).toBe(true);
  });
});
