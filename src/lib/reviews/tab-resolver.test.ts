import { describe, expect, it } from 'vitest';
import { isSameProductPage } from '@/lib/reviews/tab-resolver';

describe('isSameProductPage', () => {
  it('treats Yandex product and reviews URLs as same product', () => {
    const card =
      'https://market.yandex.ru/product--smartfon/5675714472';
    const reviews =
      'https://market.yandex.ru/product--smartfon/5675714472/reviews?sku=123';
    expect(isSameProductPage(card, reviews)).toBe(true);
  });

  it('distinguishes different product ids', () => {
    const a = 'https://market.yandex.ru/product--a/111';
    const b = 'https://market.yandex.ru/product--b/222';
    expect(isSameProductPage(a, b)).toBe(false);
  });
});
