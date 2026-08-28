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
  it('defaults to DEFAULT_SEARCH (trio + Mega + Ali + M.Video) and keeps source', () => {
    const offers = offersFromCompareProduct(product());
    expect(offers.map((o) => o.marketplace)).toEqual([
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
      'mvideo',
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
    expect(offers.map((o) => o.marketplace)).not.toContain('dns');
  });

  it('mvideo in selected list appears; source always present', () => {
    const offers = offersFromCompareProduct(product(), {
      marketplaces: ['mvideo'],
    });
    expect(offers.map((o) => o.marketplace)).toEqual(['ozon', 'mvideo']);
  });

  it('aliexpress in selected list appears; source always present', () => {
    const offers = offersFromCompareProduct(product(), {
      marketplaces: ['aliexpress'],
    });
    expect(offers.map((o) => o.marketplace)).toEqual(['ozon', 'aliexpress']);
  });
});
