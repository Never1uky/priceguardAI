import { describe, expect, it } from 'vitest';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import type { MarketplaceOffer } from '@/types/comparison';

function rankedOffer(
  partial: Partial<MarketplaceOffer> & { title: string; url: string; price: number },
  confidence: number,
): { offer: MarketplaceOffer; confidence: number } {
  return {
    confidence,
    offer: {
      marketplace: 'ozon',
      delivery: null,
      rating: null,
      found: false,
      ...partial,
    },
  };
}

describe('buildOfferFromRankedCandidates', () => {
  const searchUrl = 'https://www.ozon.ru/search/?text=airpods';

  it('auto-picks unambiguous SERP top-1 (product URL, AUTO_PICK, no tie)', () => {
    const result = buildOfferFromRankedCandidates('ozon', 'airpods', searchUrl, [
      rankedOffer(
        {
          title: 'AirPods Max',
          url: 'https://www.ozon.ru/product/airpods-max-1/',
          price: 49990,
        },
        96,
      ),
    ]);

    expect(result.found).toBe(true);
    expect(result.needsManualPick).toBeFalsy();
    expect(result.url).toContain('/product/');
    expect(result.url).not.toContain('/search');
    expect(result.price).toBe(49990);
  });

  it('uses search URL as shell (not candidate card) so refresh cannot bind picker', () => {
    const result = buildOfferFromRankedCandidates('ozon', 'airpods', searchUrl, [
      rankedOffer(
        {
          title: 'AirPods Max Midnight',
          url: 'https://www.ozon.ru/product/airpods-max-midnight/',
          price: 49990,
        },
        92,
      ),
      rankedOffer(
        {
          title: 'AirPods Max Silver',
          url: 'https://www.ozon.ru/product/airpods-max-silver/',
          price: 48990,
        },
        88,
      ),
    ]);

    expect(result.url).toBe(searchUrl);
    expect(result.url).toContain('/search');
    expect(result.searchCandidates?.every((c) => c.url.includes('/product/'))).toBe(true);
    expect(result.searchCandidates?.every((c) => !c.url.includes('/search'))).toBe(true);
    expect(result.found).toBe(false);
    expect(result.needsManualPick).toBe(true);
  });

  it('returns not_found with search URL only when no product cards', () => {
    const result = buildOfferFromRankedCandidates('ozon', 'airpods', searchUrl, [
      rankedOffer(
        {
          title: 'Listing',
          url: searchUrl,
          price: 100,
        },
        80,
      ),
    ]);

    expect(result.found).toBe(false);
    expect(result.matchStatus).toBe('not_found');
    expect(result.needsManualPick).toBeFalsy();
    expect(result.url).toBe(searchUrl);
  });
});
