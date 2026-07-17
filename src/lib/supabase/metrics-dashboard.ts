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

export interface MetricsDashboardData {
  ok: boolean;
  generatedAt: string;
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
  error?: string;
  [key: string]: unknown;
}

export async function fetchMetricsDashboard(): Promise<MetricsDashboardData> {
  return callEdge<MetricsDashboardData>('metrics-dashboard', {});
}
