import { describe, expect, it } from 'vitest';
import { isProductNotificationsEnabled } from '@/lib/notification-settings';
import type { TrackedProduct } from '@/types/product';

const baseProduct: TrackedProduct = {
  id: 'wb-1',
  marketplace: 'wildberries',
  title: 'Test',
  price: 1000,
  currency: 'RUB',
  article: '1',
  url: 'https://www.wildberries.ru/catalog/1/detail.aspx',
  scrapedAt: Date.now(),
  trackedAt: Date.now(),
  initialPrice: 1000,
  lowestPrice: 1000,
};

describe('isProductNotificationsEnabled', () => {
  it('defaults to enabled when undefined', () => {
    expect(isProductNotificationsEnabled(baseProduct)).toBe(true);
  });

  it('respects explicit false', () => {
    expect(isProductNotificationsEnabled({ ...baseProduct, notificationsEnabled: false })).toBe(false);
  });

  it('respects explicit true', () => {
    expect(isProductNotificationsEnabled({ ...baseProduct, notificationsEnabled: true })).toBe(true);
  });
});
