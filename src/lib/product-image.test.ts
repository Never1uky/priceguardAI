import { describe, expect, it } from 'vitest';
import {
  buildWbImageUrl,
  buildWbImageUrlAlternatives,
  getWbBasketHost,
} from '@/utils/wb-image';
import { getCompareProductImageSources } from '@/lib/product-image';
import type { CompareProduct } from '@/types/comparison';

describe('wb-image basket hosts', () => {
  it('maps mid and high vols to padded hosts', () => {
    expect(getWbBasketHost(100)).toBe('01');
    expect(getWbBasketHost(2100)).toBe('14');
    expect(getWbBasketHost(12660)).toMatch(/^\d{2}$/);
  });

  it('builds primary and alternative CDN urls', () => {
    const nm = '1266048474';
    const primary = buildWbImageUrl(nm);
    const alts = buildWbImageUrlAlternatives(nm);
    expect(primary).toContain('/vol12660/');
    expect(primary).toContain('/images/big/1.webp');
    expect(alts.length).toBeGreaterThan(5);
    expect(alts.every((u) => u.includes(nm))).toBe(true);
  });
});

describe('getCompareProductImageSources', () => {
  it('prefers sourceOffer image and seeds WB alternatives from article', () => {
    const product: CompareProduct = {
      id: 'cmp_1',
      title: 'Poco',
      article: '1266048474',
      sourceUrl: 'https://www.wildberries.ru/catalog/1266048474/detail.aspx',
      sourceMarketplace: 'wildberries',
      marketplaceUrls: {},
      sourceOffer: {
        marketplace: 'wildberries',
        title: 'Poco',
        price: 8000,
        delivery: null,
        rating: null,
        url: 'https://www.wildberries.ru/catalog/1266048474/detail.aspx',
        found: true,
        imageUrl: 'https://basket-50.wbbasket.ru/vol12660/part1266048/1266048474/images/big/1.webp',
      },
      addedAt: 1,
    };

    const sources = getCompareProductImageSources(product);
    expect(sources.imageUrl).toContain('1266048474');
    expect((sources.imageUrlAlternatives?.length ?? 0) > 0).toBe(true);
  });
});
