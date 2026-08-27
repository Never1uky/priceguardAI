import { describe, expect, it } from 'vitest';
import {
  isMarketplaceCompareEnabled,
  isMarketplaceMonitoringEnabled,
  mergeMarketplaceFlags,
} from './marketplace-flags.ts';

describe('marketplace-flags', () => {
  it('defaults: core trio on, test MPs off', () => {
    const { flags } = mergeMarketplaceFlags({}, [], undefined);
    expect(flags.wildberries?.marketplaceEnabled).toBe(true);
    expect(flags.ozon?.monitoringEnabled).toBe(true);
    expect(flags.megamarket?.marketplaceEnabled).toBe(false);
    expect(flags.megamarket?.monitoringEnabled).toBe(false);
  });

  it('compare-only rollout: MP on for compare, off for monitoring', () => {
    const { flags } = mergeMarketplaceFlags(
      {},
      [{
        marketplace_id: 'megamarket',
        marketplace_enabled: true,
        monitoring_enabled: false,
      }],
      undefined,
    );
    const loaded = { flags, source: 'db' as const, updatedAt: null };
    expect(isMarketplaceCompareEnabled(loaded, 'megamarket')).toBe(true);
    expect(isMarketplaceMonitoringEnabled(loaded, 'megamarket')).toBe(false);
  });

  it('monitoring respects global allowlist intersection', () => {
    const { flags } = mergeMarketplaceFlags({}, [], undefined);
    const loaded = { flags, source: 'defaults' as const, updatedAt: null };
    expect(isMarketplaceMonitoringEnabled(loaded, 'ozon', ['wildberries'])).toBe(false);
    expect(isMarketplaceMonitoringEnabled(loaded, 'ozon', ['ozon', 'wildberries'])).toBe(true);
  });

  it('env JSON overlay wins over DB', () => {
    const { flags, source } = mergeMarketplaceFlags(
      {},
      [{ marketplace_id: 'dns', marketplace_enabled: true, monitoring_enabled: true }],
      JSON.stringify({ dns: { marketplace_enabled: false, monitoring_enabled: false } }),
    );
    expect(source).toBe('env_overlay');
    expect(flags.dns?.marketplaceEnabled).toBe(false);
  });
});
