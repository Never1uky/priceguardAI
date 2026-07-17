import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildSerpCacheKey,
  getSerpCachedOffer,
  setSerpCachedOffer,
  SERP_CACHE_TTL_MS,
} from '@/lib/serp-cache';
import type { MarketplaceOffer } from '@/types/comparison';

const store: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of list) {
          if (store[key] !== undefined) result[key] = store[key];
        }
        return result;
      }),
      set: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(store, data);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) {
          delete store[key];
        }
      }),
    },
  },
});

describe('serp-cache', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it('buildSerpCacheKey нормализует регистр и пробелы', () => {
    const key = buildSerpCacheKey('wildberries', ' Redmi  15 ', 'Xiaomi Redmi 15');
    expect(key).toBe('wildberries|redmi 15|xiaomi redmi 15');
  });

  it('сохраняет и возвращает оффер в пределах TTL', async () => {
    const offer: MarketplaceOffer = {
      marketplace: 'wildberries',
      title: 'Redmi 15',
      price: 15990,
      delivery: null,
      rating: null,
      url: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      found: true,
    };

    await setSerpCachedOffer('wildberries', 'Redmi 15', 'Xiaomi Redmi 15', offer);
    const cached = await getSerpCachedOffer('wildberries', 'Redmi 15', 'Xiaomi Redmi 15');

    expect(cached?.price).toBe(15990);
    expect(cached?.title).toBe('Redmi 15');
  });

  it('не кэширует notFound', async () => {
    const offer: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Test',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://www.ozon.ru/search/?text=x',
      found: false,
      error: 'Не найдено',
    };

    await setSerpCachedOffer('ozon', 'test', 'Test', offer);
    const cached = await getSerpCachedOffer('ozon', 'test', 'Test');
    expect(cached).toBeNull();
  });

  it('не возвращает просроченный кэш', async () => {
    const offer: MarketplaceOffer = {
      marketplace: 'ozon',
      title: 'Test',
      price: 1000,
      delivery: null,
      rating: null,
      url: 'https://ozon.ru/product/1',
      found: true,
    };

    await setSerpCachedOffer('ozon', 'test', 'Test', offer);

    const key = buildSerpCacheKey('ozon', 'test', 'Test');
    const raw = store['priceguard_serp_cache_v1'] as Record<string, { cachedAt: number }>;
    raw[key].cachedAt = Date.now() - SERP_CACHE_TTL_MS - 1_000;

    const cached = await getSerpCachedOffer('ozon', 'test', 'Test');
    expect(cached).toBeNull();
  });
});
