import { describe, expect, it } from 'vitest';
import {
  buildMyProductItems,
  compareMatchKeys,
  keysOverlap,
  sortMyProductItems,
  trackedMatchKeys,
} from '@/lib/my-products';
import type { CompareProduct } from '@/types/comparison';
import type { TrackedProduct } from '@/types/product';
import { FREE_LIMITS } from '@/types/subscription';

function tracked(partial: Partial<TrackedProduct> & Pick<TrackedProduct, 'id' | 'url' | 'article'>): TrackedProduct {
  return {
    marketplace: 'wildberries',
    title: 'Phone',
    price: 1000,
    currency: '₽',
    scrapedAt: 1,
    trackedAt: 1,
    initialPrice: 1000,
    lowestPrice: 1000,
    ...partial,
  };
}

function compare(partial: Partial<CompareProduct> & Pick<CompareProduct, 'id' | 'sourceUrl'>): CompareProduct {
  return {
    title: 'Phone',
    sourceMarketplace: 'wildberries',
    marketplaceUrls: {},
    addedAt: 1,
    ...partial,
  };
}

describe('sortMyProductItems', () => {
  it('orders by addedAt desc and never comparedAt', () => {
    const older = compare({
      id: 'cmp_old',
      sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      article: '1',
      addedAt: 100,
      comparedAt: 9999,
    });
    const newer = compare({
      id: 'cmp_new',
      sourceUrl: 'https://www.ozon.ru/product/abc-2/',
      sourceMarketplace: 'ozon',
      article: '2',
      addedAt: 200,
      comparedAt: 1,
    });
    const items = buildMyProductItems([], [older, newer]);
    expect(items.map((i) => i.compareId)).toEqual(['cmp_new', 'cmp_old']);
  });

  it('supports title and price modes', () => {
    const a = compare({
      id: 'cmp_a',
      title: 'Beta',
      sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      article: '1',
      addedAt: 1,
      sourceOffer: {
        marketplace: 'wildberries',
        title: 'Beta',
        price: 500,
        delivery: null,
        rating: null,
        url: 'https://www.wildberries.ru/catalog/1/detail.aspx',
        found: true,
      },
    });
    const b = compare({
      id: 'cmp_b',
      title: 'Alpha',
      sourceUrl: 'https://www.ozon.ru/product/abc-2/',
      sourceMarketplace: 'ozon',
      article: '2',
      addedAt: 2,
      sourceOffer: {
        marketplace: 'ozon',
        title: 'Alpha',
        price: 100,
        delivery: null,
        rating: null,
        url: 'https://www.ozon.ru/product/abc-2/',
        found: true,
      },
    });
    const items = buildMyProductItems([], [a, b]);
    expect(sortMyProductItems(items, 'title').map((i) => i.compareId)).toEqual(['cmp_b', 'cmp_a']);
    expect(sortMyProductItems(items, 'price').map((i) => i.compareId)).toEqual(['cmp_b', 'cmp_a']);
  });
});

describe('buildMyProductItems', () => {
  it('dedupes tracked and compare by URL into one slot', () => {
    const url = 'https://www.wildberries.ru/catalog/123/detail.aspx';
    const t = tracked({ id: 'wb-123', url, article: '123' });
    const c = compare({
      id: 'cmp_1',
      sourceUrl: url,
      article: '123',
      marketplaceUrls: { wildberries: url },
    });

    const items = buildMyProductItems([t], [c], { 'wb-123': true });
    expect(items).toHaveLength(1);
    expect(items[0]!.compareId).toBe('cmp_1');
    expect(items[0]!.trackedId).toBe('wb-123');
    expect(items[0]!.alertsEnabled).toBe(true);
  });

  it('keeps tracked-only and compare-only as separate slots', () => {
    const items = buildMyProductItems(
      [tracked({ id: 'wb-1', url: 'https://www.wildberries.ru/catalog/1/detail.aspx', article: '1' })],
      [
        compare({
          id: 'cmp_ozon',
          sourceUrl: 'https://www.ozon.ru/product/abc-2/',
          sourceMarketplace: 'ozon',
          article: '2',
        }),
      ],
    );
    expect(items).toHaveLength(2);
  });
});

describe('match keys', () => {
  it('builds url and article keys', () => {
    const keys = trackedMatchKeys(
      tracked({
        id: 'wb-9',
        url: 'https://www.wildberries.ru/catalog/9/detail.aspx?x=1',
        article: '9',
      }),
    );
    expect(keys.some((k) => k.startsWith('url:'))).toBe(true);
    expect(keys).toContain('art:wildberries:9');
  });

  it('compare keys include marketplace urls', () => {
    const keys = compareMatchKeys(
      compare({
        id: 'c',
        sourceUrl: 'https://www.wildberries.ru/catalog/9/detail.aspx',
        article: '9',
        marketplaceUrls: {
          ozon: 'https://www.ozon.ru/product/x-1/',
        },
      }),
    );
    expect(keys.length).toBeGreaterThanOrEqual(2);
  });

  it('keysOverlap detects shared url/article identity', () => {
    const url = 'https://www.wildberries.ru/catalog/42/detail.aspx';
    const a = trackedMatchKeys(tracked({ id: 'wb-42', url, article: '42' }));
    const b = compareMatchKeys(
      compare({
        id: 'cmp',
        sourceUrl: url,
        article: '42',
        marketplaceUrls: { wildberries: url },
      }),
    );
    expect(keysOverlap(a, b)).toBe(true);
    expect(keysOverlap(a, ['url:https://other.example/1'])).toBe(false);
  });
});

describe('FREE_LIMITS.maxMyProducts', () => {
  it('is 5', () => {
    expect(FREE_LIMITS.maxMyProducts).toBe(5);
  });
});
