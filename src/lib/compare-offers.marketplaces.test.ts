import { describe, expect, it } from 'vitest';
import { offersFromCompareProduct } from './compare-offers';
import type { CompareProduct } from '@/types/comparison';

function product(partial: Partial<CompareProduct> = {}): CompareProduct {
  return {
    id: 'p1',
    title: 'Test',
    sourceUrl: 'https://www.ozon.ru/product/x-123456',
    sourceMarketplace: 'ozon',
    marketplaceUrls: {},
    addedAt: 1,
    ...partial,
  };
}

describe('offersFromCompareProduct selected marketplaces', () => {
  it('defaults to DEFAULT_SEARCH (trio + Mega + Ali) and keeps source', () => {
    const offers = offersFromCompareProduct(product());
    expect(offers.map((o) => o.marketplace)).toEqual([
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
    ]);
  });

  it('respects selected list and always includes source', () => {
    const offers = offersFromCompareProduct(product(), {
      marketplaces: ['wildberries', 'megamarket'],
    });
    expect(offers.map((o) => o.marketplace)).toEqual([
      'wildberries',
      'ozon',
      'megamarket',
    ]);
  });

  it('does not draw remaining test MPs when not selected', () => {
    const offers = offersFromCompareProduct(product(), {
      marketplaces: ['wildberries', 'ozon', 'yandex_market'],
    });
    expect(offers.map((o) => o.marketplace)).not.toContain('lamoda');
    expect(offers.map((o) => o.marketplace)).not.toContain('mvideo');
  });

  it('aliexpress in selected list appears; source always present', () => {
    const offers = offersFromCompareProduct(product(), {
      marketplaces: ['aliexpress'],
    });
    expect(offers.map((o) => o.marketplace)).toEqual(['ozon', 'aliexpress']);
  });
});
