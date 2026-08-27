/**
 * Клиент дашборда метрик (Edge Function metrics-dashboard).
 */

import { callEdge } from '@/lib/supabase/edge';

export interface SearchMetricDailyRow {
  marketplace: string;
  day: string;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  success_rate_pct: number;
  avg_response_time_ms: number;
}

export interface AiRequestRow {
  provider: string;
  model: string;
  day: string;
  request_count: number;
  success_count: number;
  error_count: number;
  avg_duration_ms: number;
  avg_total_tokens: number;
  total_tokens: number;
}

/** Phase 12 — monitoring economics (dedup + Scrappey cost). */
export interface EconomicsDashboardBlock {
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
  scrapeRequestsPerActiveMonitoredProduct: number;
  scrapeRequestsPerUniqueTarget: number;
  dedupFactor: number;
  estimatedScrapesSaved: number;
  costEstimateRubPerDay: { optimistic: number; pessimistic: number };
  costEstimateRubPerMonth: { optimistic: number; pessimistic: number };
  assumptions?: {
    scrappeyRubPerThousandCalls: number;
    optimisticCallsPerScrape: number;
    pessimisticCallsPerScrape: number;
    note: string;
  };
}

export interface MetricsDashboardData {
  ok: boolean;
  generatedAt: string;
  periodDays?: number;
  searchDaily: SearchMetricDailyRow[];
  searchWeekly: SearchMetricDailyRow[];
  aiRequests: AiRequestRow[];
  wbSuccessRate24h: {
    total_requests: number;
    successful_requests: number;
    success_rate_pct: number;
    avg_response_time_ms: number;
  } | null;
  alerts: {
    wbLowSuccessRate: boolean;
    wbSuccessRatePct: number;
    thresholdPct: number;
  };
  economics?: EconomicsDashboardBlock;
  monitoringInventory?: {
    monitoringUsers: number;
    activeMonitoredProducts?: number;
    uniqueMonitoringTargets: number;
    avgSubscribersPerTarget: number;
    maxSubscribersPerTarget: number;
  };
  error?: string;
  [key: string]: unknown;
}

export async function fetchMetricsDashboard(
  periodDays: 1 | 7 | 30 = 30,
): Promise<MetricsDashboardData> {
  return callEdge<MetricsDashboardData>('metrics-dashboard', { periodDays });
}
