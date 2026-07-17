/**
 * Merge / guard helpers for Telegram alert settings (pure — unit-tested).
 */

import type { PriceAlertSettings } from '@/lib/compare-price-alerts';

export interface CloudAlertSettings {
  telegramChatId: string;
  telegramEnabled: boolean;
  notificationsEnabled: boolean;
  minDropRub: number;
  minDropPercent: number;
  serverMonitoring: boolean;
}

/** После reinstall: заполнить пустой local из облака. null = менять local не нужно. */
export function mergeAlertSettingsFromCloud(
  local: PriceAlertSettings,
  cloud: CloudAlertSettings | null,
): PriceAlertSettings | null {
  if (!cloud) return null;
  if (local.telegramChatId.trim().length > 0) return null;
  if (!cloud.telegramChatId.trim()) return null;

  return {
    ...local,
    telegramChatId: cloud.telegramChatId.trim(),
    telegramEnabled: cloud.telegramEnabled,
    notificationsEnabled: cloud.notificationsEnabled,
    minDropRub: cloud.minDropRub,
    minDropPercent: cloud.minDropPercent,
  };
}

/**
 * Пустой chat с клиента без clearTelegram не должен затирать облачную привязку.
 */
export function shouldPreserveCloudTelegram(input: {
  incomingChatId: string;
  clearTelegram: boolean;
  existingChatId: string | null | undefined;
}): boolean {
  if (input.clearTelegram) return false;
  if (input.incomingChatId.trim().length > 0) return false;
  return Boolean(input.existingChatId?.trim());
}
