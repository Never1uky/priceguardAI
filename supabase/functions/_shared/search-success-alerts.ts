/**
 * Ops Reliability — evaluate 24h search success alerts per marketplace.
 * Used by search-alerts cron + metrics-dashboard. Not product Telegram.
 */

export const SEARCH_SUCCESS_ALERT_MARKETPLACES = [
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
] as const;

export type SearchSuccessAlertMarketplace =
  (typeof SEARCH_SUCCESS_ALERT_MARKETPLACES)[number];

export type SearchSuccessRate24hRow = {
  marketplace: string;
  total_requests: number;
  successful_requests: number;
  success_rate_pct: number;
  avg_response_time_ms?: number | null;
};

export type SearchSuccessMpAlert = {
  marketplace: string;
  successRatePct: number;
  totalRequests: number;
  successfulRequests: number;
  avgResponseTimeMs: number | null;
  alert: boolean;
};

/** Prefer SEARCH_SUCCESS_RATE_ALERT_THRESHOLD, else WB_SUCCESS_RATE_ALERT_THRESHOLD, else 85. */
export function resolveSearchSuccessAlertThreshold(env: {
  get: (key: string) => string | undefined;
}): number {
  const primary = env.get('SEARCH_SUCCESS_RATE_ALERT_THRESHOLD');
  if (primary != null && String(primary).trim() !== '') {
    const n = Number(primary);
    if (Number.isFinite(n)) return n;
  }
  const legacy = env.get('WB_SUCCESS_RATE_ALERT_THRESHOLD');
  if (legacy != null && String(legacy).trim() !== '') {
    const n = Number(legacy);
    if (Number.isFinite(n)) return n;
  }
  return 85;
}

export function evaluateSearchSuccessAlerts(
  rows: SearchSuccessRate24hRow[],
  thresholdPct: number,
  minRequests = 5,
): {
  byMarketplace: SearchSuccessMpAlert[];
  alerting: SearchSuccessMpAlert[];
  alert: boolean;
} {
  const byMp = new Map<string, SearchSuccessRate24hRow>();
  for (const r of rows) {
    byMp.set(String(r.marketplace), r);
  }

  const byMarketplace: SearchSuccessMpAlert[] = SEARCH_SUCCESS_ALERT_MARKETPLACES.map((mp) => {
    const row = byMp.get(mp);
    const total = Number(row?.total_requests ?? 0);
    const successful = Number(row?.successful_requests ?? 0);
    const rate = Number(row?.success_rate_pct ?? 100);
    const avgMs =
      row?.avg_response_time_ms == null ? null : Number(row.avg_response_time_ms);
    const alert = total >= minRequests && rate < thresholdPct;
    return {
      marketplace: mp,
      successRatePct: rate,
      totalRequests: total,
      successfulRequests: successful,
      avgResponseTimeMs: Number.isFinite(avgMs as number) ? avgMs : null,
      alert,
    };
  });

  const alerting = byMarketplace.filter((r) => r.alert);
  return { byMarketplace, alerting, alert: alerting.length > 0 };
}

export function formatSearchSuccessAlertTelegramHtml(
  alerting: SearchSuccessMpAlert[],
  thresholdPct: number,
): string {
  const lines = alerting.map(
    (a) =>
      `• <b>${a.marketplace}</b>: ${a.successRatePct}% (${a.successfulRequests}/${a.totalRequests})`,
  );
  return (
    `⚠️ <b>PriceGuard AI</b>\n` +
    `Поиск: low success rate за 24ч (порог ${thresholdPct}%, min ${5} запросов)\n` +
    lines.join('\n')
  );
}
