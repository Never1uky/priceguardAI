/**
 * Проверка алертов поиска (Edge Function search-alerts).
 * Вызывается из background по chrome.alarms.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { getSupabaseConfig } from '@/lib/supabase/config';

export interface SearchAlertsResult {
  ok: boolean;
  alert: boolean;
  wbSuccessRatePct: number;
  totalRequests: number;
  thresholdPct: number;
  telegramSent?: boolean;
  [key: string]: unknown;
}

export async function checkSearchAlerts(): Promise<SearchAlertsResult | null> {
  if (!getSupabaseConfig().configured) return null;
  return callEdgeSafe<SearchAlertsResult>('search-alerts', {});
}

/** Локальное предупреждение + опционально серверный Telegram. */
export async function runSearchAlertCheck(): Promise<void> {
  const result = await checkSearchAlerts();
  if (!result?.alert) return;

  const msg =
    `[PriceGuard] ⚠️ WB search success rate ${result.wbSuccessRatePct}% ` +
    `(порог ${result.thresholdPct}%, запросов: ${result.totalRequests})`;
  console.warn(msg);

  if (typeof chrome !== 'undefined' && chrome.notifications) {
    chrome.notifications.create(`pg-wb-alert-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('public/icons/icon128.png'),
      title: 'PriceGuard — регресс поиска WB',
      message: `Success rate ${result.wbSuccessRatePct}% за 24ч (порог ${result.thresholdPct}%)`,
      priority: 2,
    });
  }
}
