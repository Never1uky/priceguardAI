import { beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.fn();
vi.mock('@/lib/telemetry/log', () => ({
  telemetry: { info, warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  info.mockClear();
});

describe('ops telemetry', () => {
  it('trackMarketplaceSearchStarted emits ops event without productId', async () => {
    const { trackMarketplaceSearchStarted } = await import('./ops');
    trackMarketplaceSearchStarted('ozon');
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'marketplace_search_started',
        marketplace: 'ozon',
        ops: true,
      }),
    );
    const call = info.mock.calls[0]?.[0];
    expect(call?.productId).toBeUndefined();
  });

  it('trackScrapeCacheHit includes safe payload only', async () => {
    const { trackScrapeCacheHit } = await import('./ops');
    trackScrapeCacheHit({ marketplace: 'wildberries', context: 'card' });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'scrape_cache_hit',
        data: expect.objectContaining({ context: 'card', source: 'cache' }),
        ops: true,
      }),
    );
  });
});
