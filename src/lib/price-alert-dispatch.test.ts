import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alertDropDedupeKey,
  shouldSendClientDrop,
} from '@/lib/price-alert-dispatch';

describe('alert drop dedupe', () => {
  beforeEach(() => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (obj: Record<string, unknown>) => {
            Object.assign(store, obj);
          }),
        },
      },
    });
  });

  it('same bare article → same dedupe key across marketplaces', () => {
    const wb = alertDropDedupeKey({
      marketplace: 'wildberries',
      article: '12345678',
      id: 'wb-12345678',
    });
    const ozon = alertDropDedupeKey({
      marketplace: 'ozon',
      article: '12345678',
      id: 'ozon-12345678',
    });
    expect(wb).toBe(ozon);
    expect(wb).toBe('drop:art:12345678');
  });

  it('drop vs cheaper kinds stay separate', () => {
    const ref = {
      marketplace: 'yandex_market' as const,
      article: '123456789',
      url: 'https://market.yandex.ru/product/123456789',
    };
    expect(alertDropDedupeKey(ref, 'drop')).toBe('drop:art:123456789');
    expect(alertDropDedupeKey(ref, 'cheaper')).toBe('cheaper:art:123456789');
  });

  it('double dispatch same drop → only first send', async () => {
    const key = 'drop:art:99988877';
    expect(await shouldSendClientDrop(key, 9000)).toBe(true);
    expect(await shouldSendClientDrop(key, 9000)).toBe(false);
    expect(await shouldSendClientDrop(key, 8950)).toBe(false);
  });
});
