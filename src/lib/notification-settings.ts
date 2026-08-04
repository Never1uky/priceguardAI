/**
 * Глобальные и per-product настройки push-уведомлений о ценах.
 */

import { getPriceAlertSettings, type PriceAlertSettings } from '@/lib/compare-price-alerts';
import { getTrackedProduct } from '@/lib/storage';
import { syncAlertSettingsToCloud } from '@/lib/supabase/alert-settings-sync';
import type { TrackedProduct } from '@/types/product';

const SETTINGS_KEY = 'priceguard_price_alert_settings';

/** Можно ли отправить уведомление для отслеживаемого товара */
export async function areNotificationsEnabledForProduct(
  productId: string,
): Promise<boolean> {
  const globalSettings = await getPriceAlertSettings();
  if (!globalSettings.notificationsEnabled) return false;

  const tracked = await getTrackedProduct(productId);
  if (!tracked) return false;

  return isProductNotificationsEnabled(tracked);
}

/** Per-product флаг: undefined / true = включено */
export function isProductNotificationsEnabled(product: TrackedProduct): boolean {
  return product.notificationsEnabled !== false;
}

export async function savePriceAlertSettings(
  patch: Partial<PriceAlertSettings>,
  options?: {
    skipCloudSync?: boolean;
    clearTelegram?: boolean;
    /** Wait for Edge sync (always on when clearTelegram). */
    awaitCloudSync?: boolean;
  },
): Promise<PriceAlertSettings & { cloudSyncOk?: boolean; cloudSyncError?: string }> {
  const current = await getPriceAlertSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });

  if (options?.skipCloudSync) {
    return next;
  }

  const shouldAwait = Boolean(options?.clearTelegram || options?.awaitCloudSync);

  if (shouldAwait) {
    const sync = await syncAlertSettingsToCloud({
      clearTelegram: options?.clearTelegram,
    });
    return {
      ...next,
      cloudSyncOk: Boolean(sync?.ok),
      cloudSyncError: sync?.error,
    };
  }

  // Free/Premium + Telegram → серверный мониторинг (cron); Premium — приоритет
  void syncAlertSettingsToCloud({ clearTelegram: options?.clearTelegram });
  return next;
}
