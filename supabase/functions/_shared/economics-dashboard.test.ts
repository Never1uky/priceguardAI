import { describe, expect, it } from 'vitest';
import {
  buildEconomicsDashboard,
  countScrappeyMonitorScrapes,
  SCRAPPEY_RUB_PER_CALL,
} from './economics-dashboard.ts';

describe('economics-dashboard', () => {
  it('computes avg subscribers and scrape-per-product dedup KPIs', () => {
    const eco = buildEconomicsDashboard(
      {
        monitoringUsers: 10,
        activeMonitoredProducts: 40,
        uniqueMonitoringTargets: 20,
        avgSubscribersPerTarget: 2,
        maxSubscribersPerTarget: 5,
        totalSubscriberLinks: 40,
      },
      {
        monitorChecks: 80,
        monitorScrapes: 40,
        monitorCacheHits: 40,
        monitorErrors: 2,
        scrappeyMonitorScrapes: 30,
      },
      10,
    );

    expect(eco.avgSubscribersPerTarget).toBe(2);
    expect(eco.scrapeRequestsPerActiveMonitoredProduct).toBe(1); // 40/40
    expect(eco.scrapeRequestsPerUniqueTarget).toBe(2); // 40/20
    expect(eco.dedupFactor).toBe(2);
    expect(eco.cacheHitRatePct).toBe(50);
    expect(eco.checksPerDay).toBe(8);
    expect(eco.scrapeRequestsPerDay).toBe(4);
    // naive = 80 * 2 = 160; saved = 160 - 40 = 120
    expect(eco.estimatedScrapesSaved).toBe(120);
  });

  it('estimates cost from Scrappey rate', () => {
    const eco = buildEconomicsDashboard(
      {
        monitoringUsers: 1,
        activeMonitoredProducts: 1,
        uniqueMonitoringTargets: 1,
        avgSubscribersPerTarget: 1,
        maxSubscribersPerTarget: 1,
      },
      {
        monitorChecks: 4,
        monitorScrapes: 4,
        monitorCacheHits: 0,
        monitorErrors: 0,
        scrappeyMonitorScrapes: 4,
      },
      1,
    );
    // 4 scrapes * 1 call * 0.004 = 0.016/day
    expect(eco.costEstimateRubPerDay.optimistic).toBe(
      Math.round(4 * 1 * SCRAPPEY_RUB_PER_CALL * 100) / 100,
    );
    expect(eco.costEstimateRubPerDay.pessimistic).toBe(
      Math.round(4 * 2 * SCRAPPEY_RUB_PER_CALL * 100) / 100,
    );
    expect(eco.costEstimateRubPerMonth.optimistic).toBe(
      Math.round(eco.costEstimateRubPerDay.optimistic * 30 * 100) / 100,
    );
  });

  it('countScrappeyMonitorScrapes filters by payload.source', () => {
    expect(
      countScrappeyMonitorScrapes([
        { name: 'telegram_monitor_scrape', payload: { source: 'scrappey' } },
        { name: 'telegram_monitor_scrape', payload: { source: 'legacy' } },
        { name: 'telegram_monitor_cache_hit', payload: { source: 'cache' } },
      ]),
    ).toBe(1);
  });
});
