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
});
