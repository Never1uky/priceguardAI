import { describe, expect, it } from 'vitest';
import { isSafeMarketplaceUrl, safeMarketplaceHref } from '@/utils/safe-marketplace-url';

describe('safe-marketplace-url', () => {
  it('allows https marketplace hosts', () => {
    expect(isSafeMarketplaceUrl('https://www.wildberries.ru/catalog/1/detail.aspx')).toBe(true);
    expect(isSafeMarketplaceUrl('https://www.ozon.ru/product/x-1/', 'ozon')).toBe(true);
    expect(isSafeMarketplaceUrl('https://market.yandex.ru/product/1', 'yandex_market')).toBe(true);
  });

  it('rejects javascript and http', () => {
    expect(isSafeMarketplaceUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeMarketplaceUrl('http://www.ozon.ru/product/1')).toBe(false);
    expect(isSafeMarketplaceUrl('https://evil.example/ozon.ru')).toBe(false);
  });

  it('safeMarketplaceHref allows ya.ru for yandex_market', () => {
    expect(isSafeMarketplaceUrl('https://ya.ru/t/AbCd', 'yandex_market')).toBe(true);
    expect(safeMarketplaceHref('https://ya.ru/t/AbCd', 'yandex_market')).toContain('ya.ru');
  });
});
