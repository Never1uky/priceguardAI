import { describe, expect, it } from 'vitest';
import {
  compareSearchStep,
  formatCompareSearchProgress,
  formatSearchingMpCompact,
  isCompareOfferSettled,
} from './compare-search-progress';
import { SEARCHING_MP_CROSS } from '@/lib/compare-jobs';
import type { MarketplaceOffer } from '@/types/comparison';

function offer(
  marketplace: MarketplaceOffer['marketplace'],
  patch: Partial<MarketplaceOffer> = {},
): MarketplaceOffer {
  return {
    marketplace,
    found: false,
    url: '',
    title: '',
    price: null,
    delivery: null,
    rating: null,
    ...patch,
  };
}

describe('compare-search-progress', () => {
  it('settled when price / not_found / needs_choice', () => {
    expect(isCompareOfferSettled(offer('ozon', { price: 100, found: true }))).toBe(true);
    expect(isCompareOfferSettled(offer('ozon', { matchStatus: 'not_found' }))).toBe(true);
    expect(isCompareOfferSettled(offer('ozon', { needsManualPick: true }))).toBe(true);
    expect(isCompareOfferSettled(offer('ozon', { matchStatus: 'loading_card' }))).toBe(false);
  });

  it('formats Ищем на Ozon… n/total from offers length', () => {
    const offers = [
      offer('wildberries', { price: 10, found: true }),
      offer('ozon', { matchStatus: 'loading_card' }),
      offer('yandex_market'),
    ];
    expect(
      formatCompareSearchProgress({
        offers,
        searchingMarketplace: 'ozon',
        isLoading: true,
      }),
    ).toBe('Ищем на Ozon… 2/3');
    expect(compareSearchStep(offers, 'ozon')).toEqual({ step: 2, total: 3 });
  });

  it('formats cross search by count', () => {
    const offers = [
      offer('wildberries'),
      offer('ozon'),
      offer('yandex_market'),
    ];
    expect(
      formatCompareSearchProgress({
        offers,
        searchingMarketplace: SEARCHING_MP_CROSS,
        isLoading: true,
      }),
    ).toBe('Ищем на 3 площадках… 1/3');
  });

  it('compact list label', () => {
    expect(formatSearchingMpCompact('ozon')).toBe('Ищем на Ozon…');
    expect(formatSearchingMpCompact(SEARCHING_MP_CROSS, 4)).toBe('Ищем… 1/4');
    expect(formatSearchingMpCompact(SEARCHING_MP_CROSS)).toBe('Ищем…');
  });

  it('null when not loading', () => {
    expect(
      formatCompareSearchProgress({
        offers: [],
        searchingMarketplace: 'ozon',
        isLoading: false,
      }),
    ).toBeNull();
  });
});
