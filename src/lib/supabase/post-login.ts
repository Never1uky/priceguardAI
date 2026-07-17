/**
 * Хуки после успешного входа:
 * 1. Claim legacy tracked_products (device_id → user_id) — один раз на пользователя
 * 2. Push локальных товаров + pull с облака (syncTrackedProductsWithCloud)
 * 3. Realtime-подписка на tracked_products
 */

import { claimDeviceTrackedProducts } from '@/lib/supabase/claim-device';
import { getAuthSession, getAuthUser } from '@/lib/supabase/auth';
import { getDeviceId } from '@/lib/supabase/device-id';
import { syncTrackedProductsWithCloud, getStorage } from '@/lib/storage';
import { startTrackedProductsRealtime, stopTrackedProductsRealtime } from '@/lib/supabase/tracked-realtime';
import { pullAlertSettingsFromCloud, syncAlertSettingsToCloud } from '@/lib/supabase/alert-settings-sync';
import { restorePremiumFromAccount } from '@/lib/subscription';

const CLAIM_KEY_PREFIX = 'priceguard_claim_done_';

export interface PostLoginResult {
  /** Сколько legacy-записей в облаке привязано к аккаунту */
  claimed: number;
  /** Сколько дубликатов удалено при claim */
  merged: number;
  /** Локальный список изменён после sync */
  synced: boolean;
  /** Сколько товаров было локально до sync */
  localCount: number;
  /** Claim уже выполнялся ранее */
  claimSkipped: boolean;
  /** Premium восстановлен из user_premium */
  premiumRestored: boolean;
  /** Telegram-настройки восстановлены из user_alert_settings */
  telegramRestored: boolean;
}

let postLoginInFlight: Promise<PostLoginResult> | null = null;

function claimStorageKey(userId: string): string {
  return `${CLAIM_KEY_PREFIX}${userId}`;
}

/** Выполнить после login (email / Google). Идемпотентно — безопасно вызывать несколько раз. */
export async function runPostLoginHooks(): Promise<PostLoginResult> {
  if (postLoginInFlight) return postLoginInFlight;

  postLoginInFlight = executePostLoginHooks().finally(() => {
    postLoginInFlight = null;
  });

  return postLoginInFlight;
}

async function executePostLoginHooks(): Promise<PostLoginResult> {
  const session = await getAuthSession();
  const userId = session?.user?.id;
  if (!userId) {
    return {
      claimed: 0,
      merged: 0,
      synced: false,
      localCount: 0,
      claimSkipped: true,
      premiumRestored: false,
      telegramRestored: false,
    };
  }

  const storage = await getStorage();
  const localCount = storage.trackedProducts.length;

  let claimed = 0;
  let merged = 0;
  let claimSkipped = false;
  let premiumRestored = false;
  let telegramRestored = false;

  const claimKey = claimStorageKey(userId);
  const claimDone = (await chrome.storage.local.get(claimKey))[claimKey] === true;

  if (!claimDone) {
    const deviceId = await getDeviceId();
    const claimResult = await claimDeviceTrackedProducts(deviceId);
    if (claimResult) {
      claimed = claimResult.claimed;
      merged = claimResult.merged;
    }
    await chrome.storage.local.set({ [claimKey]: true });
  } else {
    claimSkipped = true;
  }

  // Push локальных товаров в облако + pull с других устройств
  const synced = await syncTrackedProductsWithCloud();
  await ensureTrackedRealtime();

  // Premium по аккаунту (после переустановки)
  try {
    const restore = await restorePremiumFromAccount();
    premiumRestored = Boolean(restore.restored);
  } catch (error) {
    console.warn('[PriceGuard Auth] restore premium failed', error);
  }

  // Telegram: сначала pull (не затереть облако пустым local), затем push
  try {
    const pulled = await pullAlertSettingsFromCloud();
    telegramRestored = Boolean(pulled?.restored);
  } catch (error) {
    console.warn('[PriceGuard Auth] pull alert settings failed', error);
  }
  void syncAlertSettingsToCloud();

  console.info('[PriceGuard Auth] post-login', {
    userId: userId.slice(0, 8),
    claimed,
    merged,
    localCount,
    synced,
    claimSkipped,
    premiumRestored,
    telegramRestored,
  });

  return {
    claimed,
    merged,
    synced,
    localCount,
    claimSkipped,
    premiumRestored,
    telegramRestored,
  };
}

/** Подписка Realtime на tracked_products текущего пользователя. */
export async function ensureTrackedRealtime(): Promise<void> {
  const user = await getAuthUser();
  if (!user?.id) {
    stopTrackedProductsRealtime();
    return;
  }

  startTrackedProductsRealtime(user.id, () => {
    void syncTrackedProductsWithCloud();
  });
}

/** Остановить realtime (logout). */
export function teardownPostLogin(): void {
  stopTrackedProductsRealtime();
}
