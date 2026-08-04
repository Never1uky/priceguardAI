import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/offer-fetch', () => ({
  enrichOfferFromProductPage: vi.fn(),
  fetchOfferFromUrl: vi.fn(),
}));

import { enrichOfferFromProductPage } from '@/lib/offer-fetch';
import { enrichOfferRatingIfMissing } from '@/lib/marketplace-search';
import type { MarketplaceOffer } from '@/types/comparison';

describe('enrichOfferRatingIfMissing', () => {
  beforeEach(() => {
    vi.mocked(enrichOfferFromProductPage).mockReset();
  });

  it('fills rating from card when price present and rating null', async () => {
    const offer: MarketplaceOffer = {
      marketplace: 'ozon',
      found: true,
      title: 'Товар',
      price: 19990,
      rating: null,
      url: 'https://www.ozon.ru/product/test-123/',
      delivery: null,
    };

    vi.mocked(enrichOfferFromProductPage).mockResolvedValue({
      ...offer,
      rating: 4.7,
    });

    const out = await enrichOfferRatingIfMissing(offer);
    expect(out.rating).toBe(4.7);
    expect(enrichOfferFromProductPage).toHaveBeenCalledWith(
      offer,
      expect.objectContaining({ skipUnlocker: true }),
    );
  });

  it('does not fetch when rating already present', async () => {
    const offer: MarketplaceOffer = {
      marketplace: 'ozon',
      found: true,
      title: 'Товар',
      price: 19990,
      rating: 4.2,
      url: 'https://www.ozon.ru/product/test-123/',
      delivery: null,
    };

    const out = await enrichOfferRatingIfMissing(offer);
    expect(out.rating).toBe(4.2);
    expect(enrichOfferFromProductPage).not.toHaveBeenCalled();
  });
});
