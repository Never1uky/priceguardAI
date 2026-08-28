import { beforeEach, describe, expect, it, vi } from 'vitest';

const callEdgeSafe = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/supabase/edge', () => ({
  callEdgeSafe,
}));

beforeEach(() => {
  callEdgeSafe.mockClear();
});

describe('reportSearchMetric allowlist', () => {
  it('exports Mega and Ali in SEARCH_METRICS_ALLOWED_MARKETPLACES', async () => {
    const { SEARCH_METRICS_ALLOWED_MARKETPLACES, isSearchMetricsMarketplace } = await import(
      './flush'
    );
    expect(SEARCH_METRICS_ALLOWED_MARKETPLACES).toEqual([
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
    ]);
    expect(isSearchMetricsMarketplace('megamarket')).toBe(true);
    expect(isSearchMetricsMarketplace('aliexpress')).toBe(true);
    expect(isSearchMetricsMarketplace('mvideo')).toBe(false);
  });

  it('sends search-metrics for trio, Mega, and Ali with truncated query', async () => {
    const { reportSearchMetric } = await import('./flush');
    for (const marketplace of [
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
    ] as const) {
      callEdgeSafe.mockClear();
      await reportSearchMetric({
        marketplace,
        searchQuery: 'x'.repeat(400),
        success: true,
        responseTimeMs: 1200,
        foundProductId: 'https://example.com/item/1'.repeat(5),
      });
      expect(callEdgeSafe).toHaveBeenCalledWith(
        'search-metrics',
        expect.objectContaining({
          marketplace,
          success: true,
          responseTimeMs: 1200,
          searchQuery: 'x'.repeat(300),
          telemetry: true,
        }),
      );
    }
  });

  it('skips unsupported marketplaces (no Edge call)', async () => {
    const { reportSearchMetric } = await import('./flush');
    await reportSearchMetric({
      marketplace: 'mvideo',
      success: false,
    });
    expect(callEdgeSafe).not.toHaveBeenCalled();
  });
});
