import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COST_GUARDS,
  isScrappeyMarketplace,
  mergeCostGuards,
  scraperForMarketplace,
  trackLimitForPlan,
} from './cost-guards.ts';

describe('cost-guards', () => {
  it('uses defaults when no row/env', () => {
    const g = mergeCostGuards(DEFAULT_COST_GUARDS, null, {});
    expect(g.freeTrackLimit).toBe(5);
    expect(g.premiumTrackLimit).toBe(50);
    expect(g.scrappeyEnabled).toBe(true);
    expect(g.scrappeyMarketplaces).toContain('megamarket');
    expect(g.scrappeyMarketplaces).toContain('aliexpress');
    expect(g.monitoringMarketplaces).not.toContain('megamarket');
    expect(g.monitoringMarketplaces).not.toContain('aliexpress');
    expect(g.source).toBe('defaults');
  });

  it('applies DB row', () => {
    const g = mergeCostGuards(DEFAULT_COST_GUARDS, {
      free_track_limit: 3,
      premium_track_limit: 20,
      fresh_ms_free: 12 * 3600_000,
      scrappey_enabled: true,
      monitoring_marketplaces: ['wildberries', 'ozon'],
      scrappey_marketplaces: ['ozon'],
    }, {});
    expect(g.freeTrackLimit).toBe(3);
    expect(g.premiumTrackLimit).toBe(20);
    expect(g.freshMsFree).toBe(12 * 3600_000);
    expect(g.monitoringMarketplaces).toEqual(['wildberries', 'ozon']);
    expect(isScrappeyMarketplace(g, 'ozon')).toBe(true);
    expect(isScrappeyMarketplace(g, 'wildberries')).toBe(false);
    expect(g.source).toBe('db');
  });

  it('env kill-switch disables Scrappey over DB', () => {
    const g = mergeCostGuards(DEFAULT_COST_GUARDS, { scrappey_enabled: true }, {
      COST_GUARDS_SCRAPPEY_ENABLED: '0',
    });
    expect(g.scrappeyEnabled).toBe(false);
    expect(g.source).toBe('env_overlay');
    expect(scraperForMarketplace(g, 'ozon', { apiKey: 'k' })).toBeNull();
  });

  it('env can disable expensive MP monitoring', () => {
    const g = mergeCostGuards(DEFAULT_COST_GUARDS, null, {
      COST_GUARDS_MONITORING_MARKETPLACES: 'wildberries',
      COST_GUARDS_SCRAPPEY_MARKETPLACES: '',
    });
    expect(g.monitoringMarketplaces).toEqual(['wildberries']);
  });

  it('track limits are server-side', () => {
    const g = mergeCostGuards(DEFAULT_COST_GUARDS, { free_track_limit: 2 }, {});
    expect(trackLimitForPlan(g, false)).toBe(2);
    expect(trackLimitForPlan(g, true)).toBe(50);
  });

  it('MEGA-3: scrappey may include megamarket; monitoring never via parse', () => {
    const g = mergeCostGuards(DEFAULT_COST_GUARDS, {
      scrappey_marketplaces: ['wildberries', 'ozon', 'yandex_market', 'megamarket', 'lamoda'],
      monitoring_marketplaces: ['wildberries', 'ozon', 'yandex_market', 'megamarket'],
    }, {});
    expect(g.scrappeyMarketplaces).toContain('megamarket');
    expect(g.scrappeyMarketplaces).not.toContain('lamoda');
    expect(g.monitoringMarketplaces).not.toContain('megamarket');
    expect(isScrappeyMarketplace(g, 'megamarket')).toBe(true);
    expect(scraperForMarketplace(g, 'megamarket', { apiKey: 'k' })).toEqual({ apiKey: 'k' });
  });

  it('ALI-3: scrappey may include aliexpress; monitoring never via parse', () => {
    const g = mergeCostGuards(DEFAULT_COST_GUARDS, {
      scrappey_marketplaces: [
        'wildberries',
        'ozon',
        'yandex_market',
        'megamarket',
        'aliexpress',
        'dns',
      ],
      monitoring_marketplaces: ['wildberries', 'ozon', 'yandex_market', 'aliexpress'],
    }, {});
    expect(g.scrappeyMarketplaces).toContain('aliexpress');
    expect(g.scrappeyMarketplaces).not.toContain('dns');
    expect(g.monitoringMarketplaces).not.toContain('aliexpress');
    expect(isScrappeyMarketplace(g, 'aliexpress')).toBe(true);
    expect(scraperForMarketplace(g, 'aliexpress', { apiKey: 'k' })).toEqual({ apiKey: 'k' });
  });
});
