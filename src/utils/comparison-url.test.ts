import { describe, expect, it } from 'vitest';
import {
  buildMarketplaceSearchUrl,
  detectComparisonMarketplace,
  resolveCompareCandidateUrl,
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
});
