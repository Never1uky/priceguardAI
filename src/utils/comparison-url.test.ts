import { describe, expect, it } from 'vitest';
import {
  buildMarketplaceSearchUrl,
  detectComparisonMarketplace,
  isMarketplaceSerpUrl,
  resolveCompareCandidateUrl,
  serpSearchQueryRelated,
} from '@/utils/comparison-url';

describe('comparison-url detect / resolve', () => {
  it('detects ya.ru as yandex_market', () => {
    expect(detectComparisonMarketplace('https://ya.ru/t/AbCdEf')).toBe('yandex_market');
    expect(detectComparisonMarketplace('https://www.ya.ru/product/123')).toBe('yandex_market');
    expect(detectComparisonMarketplace('https://market.yandex.ru/product/1')).toBe('yandex_market');
  });

  it('resolves relative candidate URLs against marketplace origin', () => {
    expect(resolveCompareCandidateUrl('/product/airpods-123/', 'ozon')).toBe(
      'https://www.ozon.ru/product/airpods-123/',
    );
    expect(resolveCompareCandidateUrl('/catalog/111/detail.aspx', 'wildberries')).toContain(
      'wildberries.ru',
    );
    expect(resolveCompareCandidateUrl('/product--x/99', 'yandex_market')).toContain(
      'market.yandex.ru',
    );
  });

  it('ozon search URL denies category prediction', () => {
    const url = buildMarketplaceSearchUrl('ozon', 'Xiaomi Redmi');
    expect(url).toContain('deny_category_prediction=true');
    expect(url).toContain('from_global=true');
    expect(url).toContain('/search/?');
  });

  it('isMarketplaceSerpUrl detects WB / Ozon / YM search pages, not cards', () => {
    expect(
      isMarketplaceSerpUrl(
        'https://www.wildberries.ru/catalog/0/search.aspx?search=pixel',
        'wildberries',
      ),
    ).toBe(true);
    expect(
      isMarketplaceSerpUrl('https://www.wildberries.ru/catalog/123/detail.aspx', 'wildberries'),
    ).toBe(false);
    expect(isMarketplaceSerpUrl('https://www.ozon.ru/search/?text=pixel', 'ozon')).toBe(true);
    expect(isMarketplaceSerpUrl('https://www.ozon.ru/product/foo-1/', 'ozon')).toBe(false);
    expect(isMarketplaceSerpUrl('https://market.yandex.ru/search?text=pixel', 'yandex_market')).toBe(
      true,
    );
    expect(
      isMarketplaceSerpUrl('https://market.yandex.ru/card/foo/123', 'yandex_market'),
    ).toBe(false);
  });

  it('serpSearchQueryRelated reuses Pixel SERP and skips unrelated query', () => {
    const ymPixel =
      'https://market.yandex.ru/search?text=Google%20%D0%A1%D0%BC%D0%B0%D1%80%D1%82%D1%84%D0%BE%D0%BD%20Pixel';
    expect(serpSearchQueryRelated(ymPixel, 'Google Pixel 8 128')).toBe(true);
    expect(serpSearchQueryRelated(ymPixel, 'Xiaomi Redmi Buds 8')).toBe(false);
  });
});
