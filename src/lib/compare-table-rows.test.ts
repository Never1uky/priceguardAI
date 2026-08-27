import { describe, expect, it } from 'vitest';
import type { MarketplaceOffer } from '@/types/comparison';
import {
  COMPARE_TABLE_VISIBLE_ROW_LIMIT,
  collapseCompareTableRows,
  sortOffersForTableDisplay,
} from './compare-table-rows';

function offer(
  marketplace: MarketplaceOffer['marketplace'],
  partial: Partial<MarketplaceOffer> = {},
): MarketplaceOffer {
  return {
    marketplace,
    url: `https://example.com/${marketplace}`,
    title: marketplace,
    price: null,
    delivery: null,
    rating: null,
    found: false,
    ...partial,
  };
}

describe('sortOffersForTableDisplay', () => {
  it('puts source first, then priced ascending, then loading, then not_found', () => {
    const offers = [
      offer('lamoda', { matchStatus: 'not_found' }),
      offer('ozon', { found: true, price: 500 }),
      offer('wildberries', { found: true, price: 300 }),
      offer('megamarket', { matchStatus: 'loading_card' }),
      offer('yandex_market', { found: true, price: 200 }),
    ];
    const sorted = sortOffersForTableDisplay(offers, 'wildberries');
    expect(sorted.map((o) => o.marketplace)).toEqual([
      'wildberries',
      'yandex_market',
      'ozon',
      'megamarket',
      'lamoda',
    ]);
  });
});

describe('collapseCompareTableRows', () => {
  it('shows all when ≤ limit', () => {
    const offers = [
      offer('wildberries', { found: true, price: 100 }),
      offer('ozon', { found: true, price: 200 }),
      offer('yandex_market', { matchStatus: 'not_found' }),
      offer('megamarket', { matchStatus: 'not_found' }),
    ];
    const r = collapseCompareTableRows(offers, {
      sourceMarketplace: 'wildberries',
      expanded: false,
    });
    expect(r.visible).toHaveLength(4);
    expect(r.hiddenCount).toBe(0);
  });

  it('collapses to limit and reports hidden count when not expanded', () => {
    const offers = [
      offer('wildberries', { found: true, price: 100 }),
      offer('ozon', { found: true, price: 200 }),
      offer('yandex_market', { found: true, price: 150 }),
      offer('megamarket', { matchStatus: 'not_found' }),
      offer('lamoda', { matchStatus: 'not_found' }),
      offer('mvideo', { matchStatus: 'loading_card' }),
      offer('dns', { matchStatus: 'not_found' }),
      offer('citilink', { matchStatus: 'not_found' }),
      offer('aliexpress', { matchStatus: 'not_found' }),
    ];
    expect(offers).toHaveLength(9);

    const collapsed = collapseCompareTableRows(offers, {
      sourceMarketplace: 'wildberries',
      expanded: false,
    });
    expect(collapsed.visible).toHaveLength(COMPARE_TABLE_VISIBLE_ROW_LIMIT);
    expect(collapsed.hiddenCount).toBe(5);
    expect(collapsed.visible.map((o) => o.marketplace)).toEqual([
      'wildberries',
      'yandex_market',
      'ozon',
      'mvideo',
    ]);
    expect(collapsed.hidden).toHaveLength(5);

    const expanded = collapseCompareTableRows(offers, {
      sourceMarketplace: 'wildberries',
      expanded: true,
    });
    expect(expanded.visible).toHaveLength(9);
    expect(expanded.hiddenCount).toBe(0);
  });
});
