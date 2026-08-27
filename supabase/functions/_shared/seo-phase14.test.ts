import { describe, expect, it } from 'vitest';
import { mergeSeoOffers } from './seo-publish-core.ts';

describe('Phase 14 SEO offers merge', () => {
  it('mergeSeoOffers keeps one listing identity per marketplace+productId', () => {
    const merged = mergeSeoOffers(
      [
        { marketplace: 'ozon', productId: '1', url: 'https://ozon.ru/1', price: 100 },
        { marketplace: 'wildberries', productId: '2', url: 'https://wb.ru/2', price: 90 },
      ],
      [
        { marketplace: 'ozon', productId: '1', url: 'https://ozon.ru/1', price: 95 },
        { marketplace: 'yandex_market', productId: '3', url: 'https://market.yandex.ru/3', price: 110 },
      ],
    );
    expect(merged.some((o) => o.marketplace === 'yandex_market')).toBe(true);
    expect(merged.filter((o) => o.marketplace === 'ozon')).toHaveLength(1);
  });

  it('does not invent per-seller page keys — offers stay flat snapshots', () => {
    const twoSellersSameMp = mergeSeoOffers([
      { marketplace: 'ozon', productId: '111', url: 'https://ozon.ru/111', price: 100 },
      { marketplace: 'ozon', productId: '222', url: 'https://ozon.ru/222', price: 99 },
    ]);
    expect(twoSellersSameMp.length).toBeLessThanOrEqual(6);
    expect(twoSellersSameMp.every((o) => o.marketplace && o.productId)).toBe(true);
  });
});
