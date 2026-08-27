/**
 * Phase 12 — Economics dashboard aggregates (pure, testable).
 * Cost rate: 4 ₽ / 1000 Scrappey API calls (ops assumption).
 */

/** ₽ per Scrappey API call */
export const SCRAPPEY_RUB_PER_CALL = 4 / 1000;

export interface EconomicsInventoryInput {
  /** Users with Telegram server monitoring enabled */
  monitoringUsers: number;
  /** Active tracked rows (deleted=false) for monitoring users */
  activeMonitoredProducts: number;
  /** Unique marketplace:product_id targets */
  uniqueMonitoringTargets: number;
  /** Sum of subscribers across unique targets / unique targets */
  avgSubscribersPerTarget: number;
  maxSubscribersPerTarget: number;
  /** Total subscriber-rows (= sum of set sizes) — optional cross-check */
  totalSubscriberLinks?: number;
}

export interface EconomicsOpsInput {
  /** telegram_monitor_check count in period */
  monitorChecks: number;
  /** telegram_monitor_scrape (live) */
  monitorScrapes: number;
  /** telegram_monitor_cache_hit */
  monitorCacheHits: number;
  /** telegram_monitor_error */
  monitorErrors: number;
  /** scrape_request (client card/unlocker) — optional */
  clientScrapeRequests?: number;
  /** Of monitor scrapes, how many used Scrappey (payload.source=scrappey) */
  scrappeyMonitorScrapes?: number;
}

export interface EconomicsDashboard {
  periodDays: number;
  activeMonitoredProducts: number;
  uniqueMonitoringTargets: number;
  monitoringUsers: number;
  subscribers: number;
  avgSubscribersPerTarget: number;
  maxSubscribersPerTarget: number;
  checksPerDay: number;
  scrapeRequestsPerDay: number;
  cacheHitRatePct: number;
  scrapeFailures: number;
  scrapeFailuresPerDay: number;
  /** Live scrapes in period / unique targets — lower is better when shared */
  scrapeRequestsPerActiveMonitoredProduct: number;
  /** Live scrapes / unique targets over period */
  scrapeRequestsPerUniqueTarget: number;
  /**
   * Dedup efficiency: active rows / unique targets (≥1).
   * 1.0 = no sharing; 2.0 = avg 2 subscribers per SKU.
   */
  dedupFactor: number;
  /**
   * Estimated scrapes avoided vs naive 1-scrape-per-subscriber-per-check
   * (checks × avgSubscribers) − monitorScrapes, floored at 0.
   */
  estimatedScrapesSaved: number;
  costEstimateRubPerDay: {
    optimistic: number;
    pessimistic: number;
  };
  costEstimateRubPerMonth: {
    optimistic: number;
    pessimistic: number;
  };
  assumptions: {
    scrappeyRubPerThousandCalls: number;
    optimisticCallsPerScrape: number;
    pessimisticCallsPerScrape: number;
    note: string;
  };
}

function round3(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function pct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((1000 * num) / den) / 10;
}

/**
 * Build economics KPI block for metrics-dashboard.
 */
export function buildEconomicsDashboard(
  inventory: EconomicsInventoryInput,
  ops: EconomicsOpsInput,
  periodDays: number,
): EconomicsDashboard {
  const days = Math.max(1, periodDays);
  const unique = Math.max(0, inventory.uniqueMonitoringTargets);
  const active = Math.max(0, inventory.activeMonitoredProducts);
  const avgSubs = Math.max(0, inventory.avgSubscribersPerTarget);
  const checks = Math.max(0, ops.monitorChecks);
  const scrapes = Math.max(0, ops.monitorScrapes);
  const cacheHits = Math.max(0, ops.monitorCacheHits);
  const failures = Math.max(0, ops.monitorErrors);

  const scrappeyScrapes =
    ops.scrappeyMonitorScrapes != null
      ? Math.max(0, ops.scrappeyMonitorScrapes)
      : scrapes; // if unknown, treat all live monitor scrapes as cost-bearing

  const checksPerDay = round3(checks / days);
  const scrapeRequestsPerDay = round3(scrapes / days);
  const cacheHitRatePct = pct(cacheHits, cacheHits + scrapes);

  const scrapePerActive =
    active > 0 ? round3(scrapes / active) : 0;
  const scrapePerUnique = unique > 0 ? round3(scrapes / unique) : 0;
  const dedupFactor = unique > 0 ? round3(active / unique) : active > 0 ? active : 0;

  const naiveIfNoDedup = round3(checks * Math.max(1, avgSubs));
  const estimatedScrapesSaved = Math.max(0, round3(naiveIfNoDedup - scrapes));

  const OPT = 1;
  const PESS = 2;
  const rubOptimisticDay = round2(
    (scrappeyScrapes * OPT * SCRAPPEY_RUB_PER_CALL) / days,
  );
  const rubPessimisticDay = round2(
    (scrappeyScrapes * PESS * SCRAPPEY_RUB_PER_CALL) / days,
  );

  return {
    periodDays: days,
    activeMonitoredProducts: active,
    uniqueMonitoringTargets: unique,
    monitoringUsers: inventory.monitoringUsers,
    subscribers: inventory.totalSubscriberLinks ?? active,
    avgSubscribersPerTarget: avgSubs,
    maxSubscribersPerTarget: inventory.maxSubscribersPerTarget,
    checksPerDay,
    scrapeRequestsPerDay,
    cacheHitRatePct,
    scrapeFailures: failures,
    scrapeFailuresPerDay: round3(failures / days),
    scrapeRequestsPerActiveMonitoredProduct: scrapePerActive,
    scrapeRequestsPerUniqueTarget: scrapePerUnique,
    dedupFactor,
    estimatedScrapesSaved,
    costEstimateRubPerDay: {
      optimistic: rubOptimisticDay,
      pessimistic: rubPessimisticDay,
    },
    costEstimateRubPerMonth: {
      optimistic: round2(rubOptimisticDay * 30),
      pessimistic: round2(rubPessimisticDay * 30),
    },
    assumptions: {
      scrappeyRubPerThousandCalls: 4,
      optimisticCallsPerScrape: OPT,
      pessimisticCallsPerScrape: PESS,
      note:
        'Cost uses Scrappey-tagged monitor scrapes when available; else all live monitor scrapes. WB card API ≈ 0 Scrappey.',
    },
  };
}

/** Count Scrappey-tagged monitor scrapes from ops rows */
export function countScrappeyMonitorScrapes(
  rows: Array<{ name?: string; payload?: Record<string, unknown> | null }>,
): number {
  let n = 0;
  for (const r of rows) {
    if (r.name !== 'telegram_monitor_scrape') continue;
    if (String(r.payload?.source ?? '') === 'scrappey') n += 1;
  }
  return n;
}
