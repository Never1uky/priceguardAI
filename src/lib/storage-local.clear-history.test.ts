import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: store[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(store, data);
      }),
    },
  },
});

import { clearPriceHistory, getPriceHistory, recordPricePoint } from '@/lib/storage-local';

describe('clearPriceHistory', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it('removes only the given history key', async () => {
    await recordPricePoint('ozon-111', 1000);
    await recordPricePoint('ozon-222', 2000);

    await clearPriceHistory('ozon-111');

    expect(await getPriceHistory('ozon-111')).toEqual([]);
    const kept = await getPriceHistory('ozon-222');
    expect(kept).toHaveLength(1);
    expect(kept[0]?.price).toBe(2000);
  });
});
