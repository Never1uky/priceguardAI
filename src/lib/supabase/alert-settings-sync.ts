/**
 * Синхронизация Telegram-настроек и статуса Premium на сервер
 * (для cron update-prices без открытого Chrome).
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import {
  applyPriceAlertSettingsLocal,
  getPriceAlertSettings,
} from '@/lib/compare-price-alerts';
import { getSubscription, isPremium, restorePremiumFromAccount } from '@/lib/subscription';
import {
  mergeAlertSettingsFromCloud,
  type CloudAlertSettings,
} from '@/lib/supabase/alert-settings-merge';

const SERVER_MONITORING_KEY = 'priceguard_server_price_monitoring';

export interface SyncAlertSettingsResult {
  ok: boolean;
  serverMonitoring?: boolean;
  premiumActive?: boolean;
  error?: string;
}

export interface PullAlertSettingsResult {
  ok: boolean;
  restored: boolean;
  serverMonitoring?: boolean;
  error?: string;
}

export async function isServerPriceMonitoringActive(): Promise<boolean> {
  const stored = await chrome.storage.local.get(SERVER_MONITORING_KEY);
  return Boolean(stored[SERVER_MONITORING_KEY]);
}

export async function setServerPriceMonitoringActive(active: boolean): Promise<void> {
  await chrome.storage.local.set({ [SERVER_MONITORING_KEY]: active });
}

/**
 * Подтянуть настройки алертов с аккаунта (после переустановки / пустой local Chat ID).
 */
export async function pullAlertSettingsFromCloud(): Promise<PullAlertSettingsResult | null> {
  if (!(await canUseCloudFeatures())) {
    return {
      ok: false,
      restored: false,
      error: 'Нет входа в Аккаунт или облако недоступно в этой сборке расширения',
    };
  }

  const res = await callEdgeSafe<{
    ok?: boolean;
    settings?: CloudAlertSettings | null;
    error?: string;
  }>('sync-alert-settings', { action: 'get' });

  if (!res) {
    return {
      ok: false,
      restored: false,
      error: 'Не удалось загрузить настройки (sync-alert-settings get)',
    };
  }
  if (!res.ok) {
    return { ok: false, restored: false, error: res.error };
  }

  const local = await getPriceAlertSettings();
  const merged = mergeAlertSettingsFromCloud(local, res.settings ?? null);

  if (merged) {
    await applyPriceAlertSettingsLocal(merged);
  }

  const monitoring = Boolean(res.settings?.serverMonitoring);
  if (merged || (res.settings?.telegramChatId && local.telegramChatId.trim())) {
    await setServerPriceMonitoringActive(
      monitoring ||
        (Boolean(merged?.telegramEnabled) &&
          Boolean(merged?.telegramChatId?.trim()) &&
          merged?.notificationsEnabled !== false),
    );
  } else if (res.settings) {
    await setServerPriceMonitoringActive(monitoring);
  }

  return {
    ok: true,
    restored: Boolean(merged),
    serverMonitoring: await isServerPriceMonitoringActive(),
  };
}

/**
 * Удалить claim Premium на сервере (user_premium), чтобы cron не слал «приоритет Premium».
 * Локальный Free после deactivate / expired license.
 */
export async function clearPremiumClaimOnServer(): Promise<{ ok: boolean; error?: string } | null> {
  if (!(await canUseCloudFeatures())) {
    return { ok: false, error: 'Нет входа в Аккаунт' };
  }

  const res = await callEdgeSafe<{ ok?: boolean; error?: string }>('sync-alert-settings', {
    clearPremium: true,
  });

  if (!res) {
    return { ok: false, error: 'Не удалось сбросить Premium на сервере' };
  }
  return { ok: Boolean(res.ok), error: res.error };
}

/**
 * Отправить локальные настройки алертов в Supabase.
 * Free и Premium с Telegram → серверный мониторинг;
 * Premium дополнительно получает приоритет в cron.
 */
export async function syncAlertSettingsToCloud(options?: {
  clearTelegram?: boolean;
}): Promise<SyncAlertSettingsResult | null> {
  if (!(await canUseCloudFeatures())) {
    await setServerPriceMonitoringActive(false);
    return {
      ok: false,
      error: 'Нет входа в Аккаунт или облако недоступно в этой сборке расширения',
    };
  }

  const [settings, sub, premium] = await Promise.all([
    getPriceAlertSettings(),
    getSubscription(),
    isPremium(),
  ]);

  const licenseKey =
    premium && sub.source !== 'trial' && sub.licenseKey ? sub.licenseKey : undefined;

  const res = await callEdgeSafe<{
    ok?: boolean;
    serverMonitoring?: boolean;
    premiumActive?: boolean;
    telegramChatId?: string;
    telegramEnabled?: boolean;
    error?: string;
  }>('sync-alert-settings', {
    telegramEnabled: settings.telegramEnabled,
    telegramChatId: settings.telegramChatId,
    notificationsEnabled: settings.notificationsEnabled,
    minDropRub: settings.minDropRub,
    minDropPercent: settings.minDropPercent,
    licenseKey,
    clearTelegram: Boolean(options?.clearTelegram),
  });

  // Если сервер сохранил chat (в т.ч. preserve) — подтянуть в local при пустом поле
  if (
    res?.ok &&
    res.telegramChatId &&
    !settings.telegramChatId.trim() &&
    !options?.clearTelegram
  ) {
    await applyPriceAlertSettingsLocal({
      telegramChatId: res.telegramChatId,
      telegramEnabled: res.telegramEnabled ?? true,
    });
  }

  const active = Boolean(res?.ok && res.serverMonitoring);
  await setServerPriceMonitoringActive(active);

  if (!res) {
    return {
      ok: false,
      error: 'Не удалось связаться с сервером настроек (sync-alert-settings)',
    };
  }

  // Сервер говорит Premium, локально Free → восстановить (не после clearPremium)
  if (res.ok && res.premiumActive && !premium) {
    void restorePremiumFromAccount();
  }

  return {
    ok: Boolean(res.ok),
    serverMonitoring: active,
    premiumActive: Boolean(res.premiumActive),
    error: res.error,
  };
}
