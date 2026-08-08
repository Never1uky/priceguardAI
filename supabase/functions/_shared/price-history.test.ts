import { describe, expect, it, vi } from 'vitest';
import {
  PRICE_HISTORY_DEDUPE_MS,
  appendPriceHistory,
  loadPriceHistory,
} from './price-history.ts';

type Row = { price: number; recorded_at: string };

function mockClient(opts: {
  last?: Row | null;
  onInsert?: (row: Record<string, unknown>) => void;
  loadRows?: Row[];
}) {
  const chain: Record<string, unknown> = {};
  const api = {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    order: vi.fn(() => api),
    limit: vi.fn(() => api),
    maybeSingle: vi.fn(async () => ({ data: opts.last ?? null, error: null })),
    insert: vi.fn(async (row: Record<string, unknown>) => {
      opts.onInsert?.(row);
      return { error: null };
    }),
  };
  Object.assign(chain, api);

  return {
    from: vi.fn(() => api),
  } as unknown as Parameters<typeof appendPriceHistory>[0];
}

describe('appendPriceHistory', () => {
  it('skips invalid price / missing ids', async () => {
    const supabase = mockClient({});
    await appendPriceHistory(supabase, {
      userId: '',
      marketplace: 'ozon',
      productId: '1',
      price: 100,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('dedupes same price within window', async () => {
    let inserted = 0;
    const supabase = mockClient({
      last: {
        price: 1990,
        recorded_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
      onInsert: () => {
        inserted += 1;
      },
    });
    await appendPriceHistory(supabase, {
      userId: 'u1',
      marketplace: 'ozon',
      productId: 'p1',
      price: 1990,
    });
    expect(inserted).toBe(0);
  });

  it('inserts when price changed', async () => {
    let inserted: Record<string, unknown> | null = null;
    const supabase = mockClient({
      last: {
        price: 1990,
        recorded_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
      onInsert: (row) => {
        inserted = row;
      },
    });
    await appendPriceHistory(supabase, {
      userId: 'u1',
      marketplace: 'ozon',
      productId: 'p1',
      price: 1790,
    });
    expect(inserted).toMatchObject({
      user_id: 'u1',
      marketplace: 'ozon',
      product_id: 'p1',
      price: 1790,
    });
  });

  it('exports 30-minute dedupe window', () => {
    expect(PRICE_HISTORY_DEDUPE_MS).toBe(30 * 60 * 1000);
  });
});

describe('loadPriceHistory', () => {
  it('returns chronological points', async () => {
    const rows = [
      { price: 200, recorded_at: '2026-08-08T12:00:00.000Z' },
      { price: 100, recorded_at: '2026-08-07T12:00:00.000Z' },
    ];
    const api = {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      order: vi.fn(() => api),
      limit: vi.fn(async () => ({ data: rows, error: null })),
    };
    const supabase = { from: vi.fn(() => api) } as unknown as Parameters<
      typeof loadPriceHistory
    >[0];

    const out = await loadPriceHistory(supabase, {
      userId: 'u1',
      marketplace: 'ozon',
      productId: 'p1',
    });
    expect(out).toEqual([
      { price: 100, recordedAt: '2026-08-07T12:00:00.000Z' },
      { price: 200, recordedAt: '2026-08-08T12:00:00.000Z' },
    ]);
  });
});
