import { describe, expect, it } from 'vitest';
import { marketplaceSearchSkipReason } from '@/lib/marketplaces/search-gates';
import { COMPARE_MARKETPLACE_CONCURRENCY, mapPool } from '@/lib/async-pool';
import { sortCompareTargets } from '@/lib/compare-target-order';
import type { CompareProduct } from '@/types/comparison';

describe('marketplace search gates', () => {
  it('skips Lamoda for monoblock / smartphone', () => {
    expect(
      marketplaceSearchSkipReason(
        'lamoda',
        '23.8" Моноблок CHUWI Unitech 24 Full HD Ryzen 5',
      ),
    ).toMatch(/Lamoda/i);
    expect(marketplaceSearchSkipReason('lamoda', 'Смартфон Xiaomi REDMI Note 15')).toMatch(
      /Lamoda/i,
    );
  });

  it('allows Lamoda for shoes / apparel', () => {
    expect(marketplaceSearchSkipReason('lamoda', 'Salamander Лоферы Полнота F')).toBeNull();
    expect(marketplaceSearchSkipReason('lamoda', 'Куртка зимняя мужская')).toBeNull();
  });

  it('does not skip other MPs for electronics', () => {
    expect(marketplaceSearchSkipReason('mvideo', 'Моноблок CHUWI')).toBeNull();
    expect(marketplaceSearchSkipReason('dns', 'Смартфон Xiaomi')).toBeNull();
  });

  it('skips electronics retailers for apparel / detergents', () => {
    expect(marketplaceSearchSkipReason('mvideo', 'Куртка зимняя мужская')).toMatch(/М\.Видео/i);
    expect(marketplaceSearchSkipReason('dns', 'Кроссовки Nike Air')).toMatch(/DNS/i);
    expect(marketplaceSearchSkipReason('citilink', 'Порошок стиральный')).toMatch(/Ситилинк/i);
  });

  it('still allows Lamoda for shoes; electronics MPs skip shoes', () => {
    expect(marketplaceSearchSkipReason('lamoda', 'Salamander Лоферы Полнота F')).toBeNull();
    expect(marketplaceSearchSkipReason('citilink', 'Salamander Лоферы Полнота F')).toMatch(
      /Ситилинк/i,
    );
  });
});

describe('mapPool concurrency', () => {
  it('never runs more than COMPARE_MARKETPLACE_CONCURRENCY workers at once', async () => {
    expect(COMPARE_MARKETPLACE_CONCURRENCY).toBe(2);
    let active = 0;
    let peak = 0;
    const items = [1, 2, 3, 4, 5];
    await mapPool(items, COMPARE_MARKETPLACE_CONCURRENCY, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('sortCompareTargets', () => {
  it('orders known URL before core before tab-only', () => {
    const product = {
      id: '1',
      title: 'X',
      sourceUrl: 'https://www.ozon.ru/product/x-1',
      sourceMarketplace: 'ozon',
      marketplaceUrls: { dns: 'https://www.dns-shop.ru/product/abc/' },
      addedAt: 1,
    } as CompareProduct;
    const sorted = sortCompareTargets(product, [
      'lamoda',
      'wildberries',
      'dns',
      'yandex_market',
    ]);
    expect(sorted[0]).toBe('dns');
    expect(sorted.slice(1, 3)).toEqual(['wildberries', 'yandex_market']);
    expect(sorted[3]).toBe('lamoda');
  });
});
