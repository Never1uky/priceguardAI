import { describe, expect, it } from 'vitest';
import { getSearchQueryForVariant, buildCrossMarketplaceQueries, sanitizeCrossMarketplaceQuery } from '@/lib/compare-search-query';
import type { CompareProduct } from '@/types/comparison';

const baseProduct: CompareProduct = {
  id: 'test',
  title: 'Смартфон Apple iPhone 15 Pro 256GB',
  sourceUrl: 'https://www.wildberries.ru/catalog/123/detail.aspx',
  sourceMarketplace: 'wildberries',
  marketplaceUrls: {},
  addedAt: Date.now(),
  productModel: 'Apple iPhone 15 Pro',
};

describe('compare-search-query', () => {
  it('variant 0 uses productModel', () => {
    expect(getSearchQueryForVariant(baseProduct, 'ozon', 0)).toContain('iPhone');
  });

  it('variant 1 drops brand emphasis', () => {
    const q = getSearchQueryForVariant(baseProduct, 'ozon', 1);
    expect(q.toLowerCase()).toMatch(/iphone/);
  });

  it('variant 2 prefers article on same marketplace', () => {
    const withArticle: CompareProduct = {
      ...baseProduct,
      sourceMarketplace: 'ozon',
      articlesByMarketplace: { ozon: '987654321' },
    };
    expect(getSearchQueryForVariant(withArticle, 'ozon', 2)).toBe('987654321');
  });

  it('variant 0 on Ozon does not use WB source article', () => {
    const wbProduct: CompareProduct = {
      ...baseProduct,
      article: '217753044',
      productModel: 'FUJIFILM Instax Mini 12',
      title: 'FUJIFILM Фотоаппарат Instax Mini 12',
    };
    const q = getSearchQueryForVariant(wbProduct, 'ozon', 0);
    expect(q).not.toContain('217753044');
    expect(q.toLowerCase()).toMatch(/instax/);
  });

  it('buildCrossMarketplaceQueries for Ozon excludes WB article', () => {
    const wbProduct: CompareProduct = {
      ...baseProduct,
      article: '217753044',
      productModel: 'FUJIFILM Instax Mini 12',
      title: 'FUJIFILM Фотоаппарат Instax Mini 12',
      sourceMarketplace: 'wildberries',
    };
    const queries = buildCrossMarketplaceQueries(wbProduct, 'ozon');
    expect(queries.some((q) => q.includes('217753044'))).toBe(false);
    expect(queries.some((q) => /instax/i.test(q))).toBe(true);
  });

  it('sanitizeCrossMarketplaceQuery removes SKU in parentheses', () => {
    const q = sanitizeCrossMarketplaceQuery(
      'Смартфон Realme 16 5G (RMX5171) 8ГБ/256ГБ, Android, темно-серый gray',
    );
    expect(q).not.toContain('RMX5171');
    expect(q.toLowerCase()).toMatch(/realme/);
    expect(q).not.toMatch(/8ГБ\/ГБ/i);
  });

  it('Pixel 8 query keeps model number and storage digits, no bare ГБ or empty commas', () => {
    const title = 'Смартфон Google Pixel 8 8/128Gb светло-желтый Lemongrass';
    const product: CompareProduct = {
      ...baseProduct,
      title,
      productModel: undefined,
      sourceMarketplace: 'wildberries',
    };
    const q = sanitizeCrossMarketplaceQuery(
      getSearchQueryForVariant(product, 'yandex_market', 0),
      title,
    );
    expect(q.toLowerCase()).toMatch(/pixel\s*8/);
    expect(q).not.toMatch(/(?<!\d)\s*(?:ГБ|GB)\b/i);
    expect(q).not.toContain(', ,');
    expect(q).not.toMatch(/смартфон/i);

    const cross = buildCrossMarketplaceQueries(product, 'yandex_market');
    expect(cross.some((item) => /pixel\s*8/i.test(item))).toBe(true);
    expect(cross.every((item) => !item.includes(', ,'))).toBe(true);
    expect(cross.every((item) => !/(?<!\d)(?:ГБ|GB)\b/i.test(item))).toBe(true);
  });

  it('Redmi 13 query keeps model number', () => {
    const title = 'Смартфон Xiaomi Redmi 13 8/256 Черный';
    const product: CompareProduct = {
      ...baseProduct,
      title,
      productModel: undefined,
    };
    const q = sanitizeCrossMarketplaceQuery(
      getSearchQueryForVariant(product, 'ozon', 0),
      title,
    );
    expect(q.toLowerCase()).toMatch(/redmi\s*13/);
    expect(q).not.toContain(', ,');
    const cross = buildCrossMarketplaceQueries(product, 'ozon');
    expect(cross.some((item) => /8|256/.test(item))).toBe(true);
  });

  it('Pixel 7 keeps generation when productModel is stale Google Pixel', () => {
    const title = 'Смартфон Google Pixel 7 8/128Gb Lemongrass';
    const product: CompareProduct = {
      ...baseProduct,
      title,
      productModel: 'Google Pixel',
      sourceMarketplace: 'wildberries',
    };
    const cross = buildCrossMarketplaceQueries(product, 'yandex_market');
    expect(cross.every((q) => /pixel\s*7/i.test(q))).toBe(true);
    expect(cross.every((q) => !/google\s+google/i.test(q))).toBe(true);
    expect(cross.every((q) => !/(?<!\d)(?:ГБ|GB)\b/i.test(q))).toBe(true);
    expect(cross.every((q) => !q.includes(', ,'))).toBe(true);
  });

  it('ensureGenerationTokenInQuery reinjects Pixel 7 into bare Pixel query', () => {
    const bare = sanitizeCrossMarketplaceQuery(
      'Google Pixel',
      'Смартфон Google Pixel 7 8/128Gb Lemongrass',
    );
    expect(bare.toLowerCase()).toMatch(/pixel\s*7/);
  });

  it('headphones XM5 query keeps model token for cross-market search (QA P2-2)', () => {
    const xm5: CompareProduct = {
      ...baseProduct,
      title: 'Sony WH-1000XM5 беспроводные наушники',
      productModel: 'WH-1000XM5',
      sourceMarketplace: 'wildberries',
      article: '741076063',
    };
    const q = getSearchQueryForVariant(xm5, 'yandex_market', 0);
    expect(q.toLowerCase()).toMatch(/wh[-\s]?1000xm5|1000xm5/);
  });
});
