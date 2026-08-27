import { describe, expect, it } from 'vitest';
import {
  detectMarketplace,
  extractArticle,
  isProductPage,
} from '@/utils/marketplace';
import {
  buildMarketplaceSearchUrl,
  detectComparisonMarketplace,
  isMarketplaceSerpUrl,
} from '@/utils/comparison-url';
import { isProductPageUrl } from '@/lib/product-match';
import { isSafeMarketplaceUrl } from '@/utils/safe-marketplace-url';
import {
  COMPARISON_MARKETPLACE_IDS,
  DEFAULT_SEARCH_MARKETPLACE_IDS,
  MARKETPLACES,
  isMarketplaceId,
} from '@/lib/marketplaces/registry';
import {
  TEST_MARKETPLACE_IDS,
  getTabSearchAdapter,
  migrateLegacyMarketplaceId,
} from '@/lib/marketplaces/adapter-config';

const FIXTURES: Record<
  (typeof TEST_MARKETPLACE_IDS)[number],
  { product: string; search: string; article: string }
> = {
  mvideo: {
    product: 'https://www.mvideo.ru/products/smartfon-apple-iphone-15-30066712',
    search: 'https://www.mvideo.ru/product-list-page?q=iphone',
    article: '30066712',
  },
  dns: {
    product: 'https://www.dns-shop.ru/product/c9a1b2c3d4e5/smartfon-apple-iphone-15/',
    search: 'https://www.dns-shop.ru/search/?q=iphone',
    article: 'c9a1b2c3d4e5',
  },
  citilink: {
    product: 'https://www.citilink.ru/product/smartfon-apple-iphone-15-1901234/',
    search: 'https://www.citilink.ru/search/?text=iphone',
    article: '1901234',
  },
  lamoda: {
    product: 'https://www.lamoda.ru/p/mp002xw0kabc/clothes-brand-sneakers/',
    search: 'https://www.lamoda.ru/catalogsearch/result/?q=krossovki',
    article: 'mp002xw0kabc',
  },
};

describe('registry test marketplaces', () => {
  it('contains 4 remaining test ids; defaults = trio + Mega + Ali', () => {
    expect(TEST_MARKETPLACE_IDS).toHaveLength(4);
    expect(COMPARISON_MARKETPLACE_IDS).not.toContain('eldorado');
    expect(isMarketplaceId('eldorado')).toBe(false);
    for (const id of TEST_MARKETPLACE_IDS) {
      expect(COMPARISON_MARKETPLACE_IDS).toContain(id);
      expect(MARKETPLACES.find((m) => m.id === id)?.enabledByDefault).toBe(false);
    }
    expect(DEFAULT_SEARCH_MARKETPLACE_IDS).toEqual([
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
    ]);
    expect(MARKETPLACES.find((m) => m.id === 'megamarket')?.enabledByDefault).toBe(true);
    expect(MARKETPLACES.find((m) => m.id === 'aliexpress')?.enabledByDefault).toBe(true);
  });

  it('maps eldorado.ru URLs and legacy id to mvideo', () => {
    expect(migrateLegacyMarketplaceId('eldorado')).toBe('mvideo');
    expect(detectMarketplace('https://www.eldorado.ru/cat/detail/phone-12345/')).toBe('mvideo');
    expect(
      detectComparisonMarketplace('https://www.eldorado.ru/cat/detail/phone-12345/'),
    ).toBe('mvideo');
    expect(isSafeMarketplaceUrl('https://www.eldorado.ru/cat/detail/x/', 'mvideo')).toBe(true);
  });
});

describe('test marketplace URL adapters', () => {
  for (const id of TEST_MARKETPLACE_IDS) {
    const fx = FIXTURES[id];
    it(`${id}: detect, search URL, article, isProductPageUrl`, () => {
      expect(detectMarketplace(fx.product)).toBe(id);
      expect(detectComparisonMarketplace(fx.product)).toBe(id);
      expect(extractArticle(fx.product, id)).toBe(fx.article);
      expect(isProductPage(fx.product)).toBe(true);
      expect(isProductPageUrl(fx.product)).toBe(true);
      expect(isProductPage(fx.search)).toBe(false);
      expect(isMarketplaceSerpUrl(fx.search, id)).toBe(true);
      expect(isSafeMarketplaceUrl(fx.product, id)).toBe(true);
      const searchUrl = buildMarketplaceSearchUrl(id, 'iphone 15');
      expect(searchUrl.startsWith('https://')).toBe(true);
      expect(getTabSearchAdapter(id)?.hostPattern.test(fx.product)).toBe(true);
    });
  }

  it('does not invent product pages for home URLs', () => {
    expect(isProductPage('https://www.mvideo.ru/')).toBe(false);
    expect(isProductPage('https://aliexpress.ru/')).toBe(false);
    expect(detectMarketplace('https://example.com/item/1')).toBeNull();
  });
});
